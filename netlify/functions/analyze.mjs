const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function cleanText(value, max = 3000) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

export default async (req) => {
  if (req.method !== "POST") {
    return respond(
      { error: "Only POST requests are allowed." },
      405
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return respond(
      { error: "AI service is not configured." },
      500
    );
  }

  try {
    const body = await req.json();

    const action = cleanText(body.action || "analyze", 30);

    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    let prompt = "";
    let jsonMode = false;

   
    if (action === "generateQuestion") {
      const topic = cleanText(body.topic, 150);
      const level = cleanText(body.level || "Foundation", 30);
      const format = cleanText(body.format || "MCQ", 40);

      const learner = body.learnerProfile || {};

      const mastery = Number(learner.mastery);
      const safeMastery = Number.isFinite(mastery)
        ? Math.max(0, Math.min(100, mastery))
        : 0;

      const misconception = cleanText(
        learner.misconception || "Not identified",
        500
      );

      const previousQuestions = Array.isArray(body.recentQuestions)
        ? body.recentQuestions
            .slice(0, 5)
            .map(q => cleanText(q, 250))
        : [];

      if (!topic) {
        return respond(
          { error: "A topic is required." },
          400
        );
      }

      const allowedFormats = [
        "MCQ",
        "Numerical",
        "Assertion-Reason",
        "Case-Based",
        "Real-Life Application",
        "What-If",
        "Prediction",
        "Error Detection",
        "HOTS"
      ];

      const selectedFormat = allowedFormats.includes(format)
        ? format
        : "MCQ";

      prompt = `
You are LearnLoop AI, an expert Class 10 CBSE Physics adaptive tutor.

Generate ONE original educational question.

LEARNER PROFILE:
Topic: ${topic}
Difficulty: ${level}
Mastery estimate: ${safeMastery}%
Possible misconception: ${misconception}

Question format: ${selectedFormat}

Avoid repeating these recent questions:
${JSON.stringify(previousQuestions)}

REQUIREMENTS:
1. Follow Class 10 Physics level.
2. Test actual conceptual understanding, not just memorisation.
3. Match the requested difficulty and question format.
4. Use clear, age-appropriate language.
5. For MCQ, provide exactly four options.
6. For numerical questions, include sufficient information.
7. For assertion-reason questions, use standard assertion-reason options.
8. Give a correct answer and a simple explanation.
9. Do not create ambiguous or misleading questions.
10. Do not repeat the recent questions.

Return ONLY valid JSON in this exact structure:

{
  "topic": "Topic name",
  "format": "${selectedFormat}",
  "level": "${level}",
  "question": "Question text",
  "options": ["A", "B", "C", "D"],
  "answer": "Correct answer",
  "explanation": "Simple explanation",
  "concept": "Concept being tested",
  "transferChallenge": "A short changed-situation question"
}

For non-MCQ formats, options may be an empty array.
`;

      jsonMode = true;
    }

    // --------------------------------
    // ACTION 2: STUDENT ANSWER ANALYSIS
    // --------------------------------

    else if (action === "analyze") {
      const topic = cleanText(body.topic, 150);
      const question = cleanText(body.question, 2000);
      const studentAnswer = cleanText(body.studentAnswer, 1500);
      const correctAnswer = cleanText(body.correctAnswer, 1000);
      const explanation = cleanText(body.explanation, 1500);
      const confidence = cleanText(body.confidence, 50);

      if (!question || !studentAnswer) {
        return respond(
          { error: "Question and student answer are required." },
          400
        );
      }

      prompt = `
You are LearnLoop AI, an adaptive Class 10 Physics learning coach.

Analyse the student's response carefully.

TOPIC: ${topic || "General"}
QUESTION: ${question}
STUDENT ANSWER: ${studentAnswer}
CORRECT ANSWER: ${correctAnswer || "Not provided"}
STUDENT EXPLANATION: ${explanation || "Not provided"}
CONFIDENCE: ${confidence || "Not provided"}

Analyse these areas:

1. RESULT:
Is the answer correct, incorrect, or partially correct?

2. THINKING ANALYSIS:
Explain what the student's response suggests.
Identify possible misconceptions only when evidence supports them.

3. CONCEPT EXPLANATION:
Explain the correct concept in simple Class 10 language.

4. CONFIDENCE GAP:
Consider the student's confidence along with the answer.
Do not make conclusions from one attempt alone.

5. MASTERY EVIDENCE:
Distinguish between getting an answer correct and demonstrating understanding.
Mention whether more evidence is needed.

6. NEXT STEP:
Recommend one specific learning activity.

7. FOLLOW-UP QUESTION:
Create one short question that tests understanding in a different situation.

Be encouraging, accurate and concise.
Never invent student history or claim certainty without evidence.

Use these headings:
RESULT
THINKING ANALYSIS
CONCEPT EXPLANATION
CONFIDENCE GAP
MASTERY EVIDENCE
NEXT STEP
FOLLOW-UP QUESTION
`;
    }

    else {
      return respond(
        { error: "Unsupported action." },
        400
      );
    }

    const generationConfig = {
      temperature: action === "generateQuestion" ? 0.8 : 0.4,
      maxOutputTokens: action === "generateQuestion" ? 1200 : 900
    };

    if (jsonMode) {
      generationConfig.responseMimeType = "application/json";
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        data.error?.status
      );

      return respond(
        { error: "AI request failed. Please try again." },
        502
      );
    }

    const output = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("\n") || "";

    if (!output) {
      return respond(
        { error: "AI did not generate a response." },
        502
      );
    }


    if (action === "generateQuestion") {
      let generated;

      try {
        generated = JSON.parse(output);
      } catch {
        return respond(
          { error: "Could not process the generated question." },
          502
        );
      }

      if (
        !generated.question ||
        !generated.answer ||
        !generated.explanation
      ) {
        return respond(
          { error: "Generated question was incomplete." },
          502
        );
      }

      return respond({
        success: true,
        question: {
          topic: cleanText(generated.topic, 150),
          format: cleanText(generated.format, 40),
          level: cleanText(generated.level, 30),
          question: cleanText(generated.question, 2000),
          options: Array.isArray(generated.options)
            ? generated.options.slice(0, 4).map(o => cleanText(o, 300))
            : [],
          answer: cleanText(generated.answer, 500),
          explanation: cleanText(generated.explanation, 1000),
          concept: cleanText(generated.concept, 300),
          transferChallenge: cleanText(
            generated.transferChallenge,
            700
          )
        }
      });
    }

   
    return respond({
      success: true,
      feedback: output
    });

  } catch (error) {
    console.error(
      "LearnLoop function error:",
      error.message
    );

    return respond(
      { error: "Something went wrong. Please try again." },
      500
    );
  }
};
