export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Only POST requests are allowed." }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    return json({ success: false, error: "GEMINI_API_KEY is missing in Netlify environment variables." }, 500);
  }

  try {
    const body = await req.json();

    if (body.action === "generateQuestion") {
      return await generateQuestion(body, apiKey, model);
    }

    if (body.action === "analyze") {
      return await analyzeAnswer(body, apiKey, model);
    }

    return json({ success: false, error: "Unknown action." }, 400);

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
    headers: { "Content-Type": "application/json" }
  });
}

async function askGemini(prompt, apiKey, model) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json"
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await response.json();

      if (!response.ok) {
        const message =
          data.error?.message || `Gemini API error: ${response.status}`;

        if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
          throw new Error(message);
        }

        throw new Error(message);
      }

      const output =
        data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");

      if (!output) {
        throw new Error("Gemini returned an empty response.");
      }

      return parseJSON(output);

    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await new Promise(resolve =>
          setTimeout(resolve, 800 * Math.pow(2, attempt))
        );
      }
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

  const selectedDifficulty = difficulty || level || "Adaptive";

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
3. Use standard Indian school mathematical notation where relevant:
   ×, ÷, √, π, ∠, △, ∥, ≤, ≥, fractions, powers and proper equations.
4. Make the question conceptually correct and unambiguous.
5. Do not repeat a recent question.
6. Match the requested question format.
7. For MCQs, provide exactly four options.
8. For numerical questions, include units wherever needed.
9. Give a useful hint without revealing the answer.
10. Give a clear step-by-step explanation.
11. Keep language appropriate for the student's class.
12. Explain why this question and difficulty were selected using the learner profile. Do not invent learner history.
13. If there is insufficient learner data, say the question is a foundation-level starting point.

${languageInstruction(language)}

RETURN ONLY VALID JSON IN THIS FORMAT:
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
  "decisionReason": "Why this question and difficulty were selected"
}
`;

  const result = await askGemini(prompt, apiKey, model);

  if (!result.question || !(result.answer || result.correctAnswer)) {
    throw new Error("AI generated an incomplete question. Please try again.");
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
  const referenceAnswer = expectedAnswer ?? correctAnswer ?? "";

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
Confidence reported by student: ${confidence}

LEARNER PROFILE:
${JSON.stringify(learnerProfile)}

INSTRUCTIONS:
1. Compare the student's answer with the reference answer.
2. Accept mathematically equivalent answers.
3. Do not mark an answer incorrect only because its wording differs.
4. For numerical answers, check the calculation, units and method.
5. Give partial credit when the main concept or method is correct.
6. Identify a misconception only when there is evidence.
7. Explain the correct method in easy steps.
8. Suggest one useful next learning action.
9. Do not invent marks, history or learning evidence.
10. Be encouraging, clear and educational.
11. Use standard Indian textbook mathematical symbols where relevant.
12. Follow the requested explanation language.

${languageInstruction(language)}

RETURN ONLY VALID JSON:
{
  "verdict": "correct",
  "feedback": "Evaluation and explanation for the student",
  "strength": "What the student understood",
  "misconception": "Observed misconception or None identified",
  "nextAction": "One recommended learning action"
}

The verdict must be exactly one of:
correct, partial, incorrect, reviewed.
`;

  const result = await askGemini(prompt, apiKey, model);

  const allowed = ["correct", "partial", "incorrect", "reviewed"];

  const verdict = allowed.includes(result.verdict)
    ? result.verdict
    : "reviewed";

  const feedback = [
    `Result: ${verdict.toUpperCase()}`,
    result.feedback || "Your answer has been reviewed.",
    result.strength ? `What you understood: ${result.strength}` : "",
    result.misconception ? `Concept check: ${result.misconception}` : "",
    result.nextAction ? `Next step: ${result.nextAction}` : ""
  ].filter(Boolean).join("\n\n");

  return json({
    success: true,
    verdict,
    feedback,
    analysis: result
  });
}
