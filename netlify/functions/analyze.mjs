export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Only POST requests are allowed." }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "AI service is not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const respond = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" }
    });

  try {
    const body = await req.json();
    const { action } = body;

    let prompt = "";

    if (action === "generateQuestion") {
      const {
        subject,
        topic,
        grade,
        educationLevel,
        format,
        difficulty,
        learnerProfile,
        recentQuestions
      } = body;

      prompt = `
You are LearnLoop AI, an adaptive exam preparation tutor.

Create ONE original educational question using this learner context:
Education level: ${educationLevel || "School"}
Class/Year: ${grade || "Not specified"}
Subject: ${subject || "General"}
Topic: ${topic || "General"}
Requested format: ${format || "MCQ"}
Difficulty: ${difficulty || "Adaptive"}

Learner profile:
${JSON.stringify(learnerProfile || {})}

Recently asked questions (avoid repeating them):
${JSON.stringify(recentQuestions || [])}

Adapt the question to the learner's level and topic.
Use clear, age-appropriate language.
Make the question meaningful and academically accurate.
For MCQs, provide exactly four options.
For numerical questions, include all necessary values and units.
For other formats, follow the requested format.

Return ONLY valid JSON in this structure:
{
  "question": "Question text",
  "format": "Question format",
  "difficulty": "Difficulty level",
  "options": ["A", "B", "C", "D"],
  "correctAnswer": "Correct answer",
  "explanation": "Simple explanation",
  "hint": "A helpful hint without revealing the answer",
  "topic": "Topic name"
}

If the format is not MCQ, options can be an empty array.
`;
    } else if (action === "analyze") {
      const {
        question,
        answer,
        expectedAnswer,
        explanation,
        confidence,
        learnerProfile
      } = body;

      prompt = `
You are LearnLoop AI, an adaptive exam preparation tutor.

Evaluate the student's response.

Question:
${question || ""}

Student's answer:
${answer || ""}

Expected answer:
${expectedAnswer || "Use your subject knowledge to evaluate."}

Reference explanation:
${explanation || ""}

Student confidence:
${confidence || "Not specified"}

Learner profile:
${JSON.stringify(learnerProfile || {})}

Give supportive, accurate and useful feedback.
Identify whether the answer is correct, partially correct or incorrect.
Explain the misconception, if any.
Give one specific improvement suggestion.
Recommend what the student should practise next.

Keep the language simple and encouraging.
Do not claim the answer is correct if it is not.

Return concise plain text feedback.
`;
    } else {
      return respond({ error: "Invalid action." }, 400);
    }

    // Retry temporary Gemini server errors automatically.
    let result = null;
    let lastStatus = 503;

    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1200,
                ...(action === "generateQuestion"
                  ? { responseMimeType: "application/json" }
                  : {})
              }
            })
          }
        );

        clearTimeout(timeout);

        const data = await response.json();

        if (response.ok) {
          result = data;
          break;
        }

        lastStatus = response.status;

        console.error("Gemini API error:", response.status);

        // Retry only temporary errors.
        if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
          return respond(
            { error: "AI request failed. Please check your API configuration." },
            response.status
          );
        }
      } catch (error) {
        clearTimeout(timeout);
        lastStatus = 503;
        console.error("Gemini request temporarily failed:", error.name);
      }

      if (attempt < 2) {
        const delay = 800 * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (!result) {
      return respond({
        error: "Gemini is temporarily busy. Please try again in a minute.",
        retryable: true
      }, lastStatus >= 500 ? 503 : lastStatus);
    }

    const output =
      result.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!output) {
      return respond({
        error: "AI returned an empty response. Please try again.",
        retryable: true
      }, 502);
    }

    if (action === "generateQuestion") {
      try {
        const cleaned = output
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();

        const questionData = JSON.parse(cleaned);

        return respond({
          success: true,
          question: questionData
        });
      } catch {
        console.error("Gemini returned invalid question JSON.");
        return respond({
          error: "AI could not format the question. Please try again.",
          retryable: true
        }, 502);
      }
    }

    return respond({
      success: true,
      feedback: output
    });

  } catch (error) {
    console.error("Function error:", error.name);

    return respond({
      error: "Something went wrong. Please try again."
    }, 500);
  }
};
