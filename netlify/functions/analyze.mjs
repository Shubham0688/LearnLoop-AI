export default async (req) => {
  const headers = { "Content-Type": "application/json" };

  const respond = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });

  if (req.method !== "POST") {
    return respond({ error: "Only POST requests are allowed." }, 405);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  if (!apiKey) {
    return respond({ error: "AI service is not configured." }, 500);
  }

  try {
    const body = await req.json();

    const {
      action,
      subject,
      topic,
      grade,
      educationLevel,
      format,
      level,
      difficulty,
      learnerProfile,
      digitalTwin,
      environment,
      recentQuestions,
      question,
      studentAnswer,
      answer,
      expectedAnswer,
      correctAnswer,
      explanation,
      confidence,
      reasoning
    } = body;

    let prompt = "";

    if (action === "generateQuestion") {
      prompt = `
You are LearnLoop AI, an advanced adaptive exam-preparation tutor.

LEARNER CONTEXT
Education: ${educationLevel || "School"}
Class/year: ${grade || "Not specified"}
Subject: ${subject || "General"}
Topic: ${topic || "General"}
Question format: ${format || "MCQ"}
Difficulty: ${level || difficulty || "Adaptive"}

LEARNER MODEL / DIGITAL TWIN
${JSON.stringify(digitalTwin || learnerProfile || {})}

STUDY ENVIRONMENT
${JSON.stringify(environment || { status: "Not provided" })}

RECENT QUESTIONS — AVOID REPETITION
${JSON.stringify(recentQuestions || [])}

TASK
1. Generate one original academically accurate question.
2. Match the learner's level.
3. Adapt difficulty to available mastery evidence.
4. Avoid repeating recent questions.
5. Include a useful hint and clear explanation.
6. Include one optional real-life transfer challenge.
7. Do not claim mastery based on insufficient evidence.
8. Do not use environmental readings as proof of student attention.

For MCQ, provide exactly four options.
For non-MCQ, provide an empty options array.

Return ONLY valid JSON:
{
  "question": "Question text",
  "format": "${format || "MCQ"}",
  "level": "${level || difficulty || "Foundation"}",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "answer": "Correct answer",
  "explanation": "Simple explanation",
  "hint": "Helpful hint",
  "topic": "${topic || "General"}",
  "transferChallenge": "A short real-life application challenge",
  "decisionReason": "Why this question and difficulty were selected"
}
`;
    } else if (action === "analyze") {
      prompt = `
You are LearnLoop AI, an expert adaptive learning tutor.

LEARNER CONTEXT
Education: ${educationLevel || "School"}
Class/year: ${grade || "Not specified"}
Subject: ${subject || "General"}
Topic: ${topic || "General"}

QUESTION
${question || ""}

STUDENT ANSWER
${studentAnswer || answer || ""}

EXPECTED ANSWER
${expectedAnswer || correctAnswer || "Evaluate independently."}

STUDENT REASONING
${reasoning || explanation || "Not provided"}

CONFIDENCE
${confidence || "Not specified"}

DIGITAL TWIN
${JSON.stringify(digitalTwin || learnerProfile || {})}

STUDY ENVIRONMENT
${JSON.stringify(environment || { status: "Not provided" })}

TASK
Provide:
1. Correctness: correct, partially correct or incorrect.
2. What the student understood.
3. Any misconception.
4. A simple explanation.
5. One specific improvement suggestion.
6. The next concept or question difficulty to practise.
7. Explain why that next step is suitable.

Use simple, age-appropriate language.
Do not invent student history or claim unsupported predictions.
Environmental data must not be treated as proof of concentration.
Be encouraging but academically honest.

Return concise, structured plain text.
`;
    } else {
      return respond({ error: "Invalid action." }, 400);
    }

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
                maxOutputTokens: 1600,
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

        if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
          return respond({
            error: "AI request failed. Check API configuration."
          }, response.status);
        }
      } catch (error) {
        clearTimeout(timeout);
        lastStatus = 503;
        console.error("Gemini request error:", error.name);
      }

      if (attempt < 2) {
        await new Promise(resolve =>
          setTimeout(resolve, 800 * Math.pow(2, attempt))
        );
      }
    }

    if (!result) {
      return respond({
        error: "Gemini is temporarily busy. Please try again.",
        retryable: true
      }, 503);
    }

    const output = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!output) {
      return respond({
        error: "AI returned an empty response.",
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
        console.error("Invalid question JSON.");
        return respond({
          error: "AI could not format the question. Please retry.",
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
