export default async (req) => {
  if (req.method !== "POST") {
    return json({
      success: false,
      error: "Only POST requests are allowed."
    }, 405);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  if (!apiKey) {
    return json({
      success: false,
      error: "GEMINI_API_KEY is missing in Netlify environment variables."
    }, 500);
  }

  try {
    const body = await req.json();

    if (body.action === "generateQuestion") {
      return await generateQuestion(body, apiKey, model);
    }

    if (body.action === "analyze") {
      return await analyzeAnswer(body, apiKey, model);
    }

    return json({
      success: false,
      error: "Unknown action."
    }, 400);

  } catch (error) {
    console.error("LearnLoop error:", error);

    return json({
      success: false,
      error: error.message || "Something went wrong."
    }, 500);
  }
};


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}


async function askGemini(prompt, apiKey, model) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let lastError;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 11000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json"
          }
        }),
        signal: controller.signal
      });

      const responseText = await response.text();

      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          "Gemini returned an invalid response. Please try again."
        );
      }

      if (!response.ok) {
        const message =
          data.error?.message ||
          `Gemini API error: ${response.status}`;

        const error = new Error(message);
        error.status = response.status;

        throw error;
      }

      const output =
        data.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("");

      if (!output) {
        throw new Error("Gemini returned an empty response.");
      }

      return parseJSON(output);

    } catch (error) {
      lastError = error;

      console.error(
        `Gemini attempt ${attempt + 1} failed:`,
        error.message
      );

      const retryable =
        !error.status ||
        [408, 429, 500, 502, 503, 504].includes(error.status);

      if (attempt === 0 && retryable) {
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        break;
      }

    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Gemini request failed.");
}


function parseJSON(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }

    throw new Error("AI response could not be read as JSON.");
  }
}


function languageInstruction(language) {
  if (language === "Hindi") {
    return "Write the explanation in simple Hindi.";
  }

  if (language === "Bilingual (Hindi + English)") {
    return "Explain in simple Hindi and English together.";
  }

  return "Write the explanation in simple English.";
}


async function generateQuestion(body, apiKey, model) {
  const {
    subject = "General",
    topic = "General",
    grade = "Class 10",
    educationLevel = "School",
    format = "MCQ",
    learnerProfile = {},
    recentQuestions = [],
    textbookStyle = "Indian school textbook / NCERT-CBSE style",
    language = "English",
    mathNotation = "",
    level,
    difficulty
  } = body;

  const selectedDifficulty =
    difficulty || level || "Adaptive";

  const prompt = `
You are LearnLoop AI, an adaptive exam-preparation tutor.

Create ONE original, accurate educational practice question.

STUDENT DETAILS:
Education: ${educationLevel}
Class / Year: ${grade}
Subject: ${subject}
Topic: ${topic}
Question format: ${format}
Difficulty: ${selectedDifficulty}
Textbook preference: ${textbookStyle}
Language: ${language}

LEARNER MODEL:
${JSON.stringify(learnerProfile)}

RECENT QUESTIONS TO AVOID REPEATING:
${JSON.stringify(recentQuestions)}

MATHEMATICAL NOTATION:
${mathNotation}

INSTRUCTIONS:
1. Match the student's class and educational level.
2. Follow the requested textbook style.
3. Use standard Indian school mathematical notation:
×, ÷, √, π, ∠, △, ∥, ≤, ≥, fractions and powers.
4. Make the question accurate and unambiguous.
5. Avoid repeating recent questions.
6. Match the requested question format.
7. For MCQs, provide exactly four options.
8. For numerical questions, include units wherever needed.
9. Give a helpful hint without revealing the answer.
10. Give a clear step-by-step explanation.
11. Keep language appropriate for the student's class.
12. Explain why this question and difficulty were selected.
13. Do not invent learner history.
14. If learner data is insufficient, use a foundation-level starting question.

${languageInstruction(language)}

RETURN ONLY VALID JSON:
{
  "question": "Question text",
  "format": "${format}",
  "difficulty": "${selectedDifficulty}",
  "level": "${selectedDifficulty}",
  "topic": "${topic}",
  "options": [],
  "answer": "Correct answer",
  "correctAnswer": "Correct answer",
  "explanation": "Step-by-step explanation",
  "hint": "Helpful hint",
  "decisionReason": "Why this question was selected"
}
`;

  const result = await askGemini(prompt, apiKey, model);

  if (!result.question || !(result.answer || result.correctAnswer)) {
    throw new Error(
      "AI generated an incomplete question. Please try again."
    );
  }

  result.answer = result.answer || result.correctAnswer;
  result.correctAnswer = result.correctAnswer || result.answer;
  result.topic = result.topic || topic;
  result.format = result.format || format;
  result.difficulty = result.difficulty || selectedDifficulty;
  result.level = result.level || result.difficulty;

  return json({
    success: true,
    question: result
  });
}


async function analyzeAnswer(body, apiKey, model) {
  const {
    question = "",
    studentAnswer,
    answer,
    expectedAnswer,
    correctAnswer,
    explanation = "",
    confidence = "Medium",
    learnerProfile = {},
    subject = "General",
    topic = "General",
    grade = "Class 10",
    language = "English",
    textbookStyle = "Indian school textbook / NCERT-CBSE style"
  } = body;

  const submittedAnswer = studentAnswer ?? answer ?? "";

  const referenceAnswer =
    expectedAnswer ?? correctAnswer ?? "";

  if (!question || !String(submittedAnswer).trim()) {
    return json({
      success: false,
      error: "Question and student answer are required."
    }, 400);
  }

  const prompt = `
You are LearnLoop AI, an intelligent and supportive exam-preparation tutor.

Evaluate the student's answer fairly and accurately.

QUESTION:
${question}

STUDENT'S ANSWER:
${submittedAnswer}

REFERENCE ANSWER:
${referenceAnswer}

REFERENCE EXPLANATION:
${explanation}

STUDENT DETAILS:
Subject: ${subject}
Topic: ${topic}
Class / Year: ${grade}
Textbook style: ${textbookStyle}
Language: ${language}
Confidence: ${confidence}

LEARNER PROFILE:
${JSON.stringify(learnerProfile)}

INSTRUCTIONS:
1. Compare the student's answer with the reference answer.
2. Accept mathematically equivalent answers.
3. Accept different wording when the meaning is correct.
4. Check calculations, units and methods.
5. Give partial credit when the main method is correct.
6. Identify misconceptions only when supported by evidence.
7. Explain the correct method in easy steps.
8. Suggest one useful next learning action.
9. Do not invent marks or learning history.
10. Be encouraging and educational.
11. Use standard Indian textbook mathematical notation.
12. Follow the requested explanation language.

${languageInstruction(language)}

RETURN ONLY VALID JSON:
{
  "verdict": "correct",
  "feedback": "Evaluation and explanation",
  "strength": "What the student understood",
  "misconception": "Observed misconception or None identified",
  "nextAction": "One recommended learning action"
}

The verdict must be exactly one of:
correct, partial, incorrect, reviewed.
`;

  const result = await askGemini(prompt, apiKey, model);

  const allowed = [
    "correct",
    "partial",
    "incorrect",
    "reviewed"
  ];

  const verdict = allowed.includes(result.verdict)
    ? result.verdict
    : "reviewed";

  const feedback = [
    `Result: ${verdict.toUpperCase()}`,
    result.feedback || "Your answer has been reviewed.",
    result.strength
      ? `What you understood: ${result.strength}`
      : "",
    result.misconception
      ? `Concept check: ${result.misconception}`
      : "",
    result.nextAction
      ? `Next step: ${result.nextAction}`
      : ""
  ].filter(Boolean).join("\n\n");

  return json({
    success: true,
    verdict,
    feedback,
    analysis: result
  });
}
