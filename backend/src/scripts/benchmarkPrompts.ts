/**
 * benchmarkPrompts.ts
 *
 * The 50 labeled prompts shared by benchmark.ts (classification accuracy)
 * and calibrate.ts (seeding the performance table with real numbers).
 */


// ---------------------------------------------------------------------------
// Test suite — 50 labeled prompts across all 11 domains
//
// Difficulty key:
//   easy — the rule-based classifier fires at least one keyword signal;
//          correct routing does NOT require the embedding path.
//   hard — no domain-specific keywords; correct routing requires the embedding
//          path (semantic similarity to anchor prompts).
//          If hard prompts misclassify, check OPENAI_API_KEY and anchor coverage.
//
// Domain distribution: ~4–5 prompts per domain (2–3 easy, 2 hard)
// ---------------------------------------------------------------------------

export type Domain =
  | 'coding' | 'coding_debug'
  | 'math' | 'math_reasoning'
  | 'creative' | 'general' | 'general_chat'
  | 'research' | 'summarization' | 'vision' | 'multilingual';

export type Difficulty = 'easy' | 'hard';

export interface TestCase {
  prompt:         string;
  expectedDomain: Domain;
  difficulty:     Difficulty;
}

export const TEST_CASES: readonly TestCase[] = [

  // ── coding (5) — easy: language/syntax keywords; hard: implementation described without them ──
  { prompt: 'Write a TypeScript function that debounces API calls with configurable delay',
    expectedDomain: 'coding', difficulty: 'easy' },
  { prompt: 'Implement a binary search algorithm in Python that handles duplicate values',
    expectedDomain: 'coding', difficulty: 'easy' },
  { prompt: 'Write a SQL query using window functions to rank employees by salary within each department',
    expectedDomain: 'coding', difficulty: 'easy' },
  { prompt: 'I need to build a service that queues work items and processes them one at a time so they do not interfere with each other',
    expectedDomain: 'coding', difficulty: 'hard' },
  { prompt: 'What is the cleanest way to share state between two isolated parts of an application that do not know about each other?',
    expectedDomain: 'coding', difficulty: 'hard' },

  // ── coding_debug (4) — easy: error/debug keywords; hard: bug described symptomatically ──
  { prompt: 'Fix this error: TypeError: Cannot read properties of undefined (reading "map") at line 42',
    expectedDomain: 'coding_debug', difficulty: 'easy' },
  { prompt: 'My Python script throws a traceback: KeyError "user_id" inside the auth middleware',
    expectedDomain: 'coding_debug', difficulty: 'easy' },
  { prompt: 'My API returns a 200 response but the UI never updates, even though the network tab shows the correct payload arriving',
    expectedDomain: 'coding_debug', difficulty: 'hard' },
  { prompt: 'A job that runs every night produces correct totals on Monday but wrong ones on Friday — the inputs look identical',
    expectedDomain: 'coding_debug', difficulty: 'hard' },

  // ── math (5) — easy: symbolic keywords (solve, integral, matrix); hard: numerical without signals ──
  { prompt: 'Solve the system of equations: 2x + 3y = 12 and x - y = 1',
    expectedDomain: 'math', difficulty: 'easy' },
  { prompt: 'Calculate the eigenvalues of the matrix [[3, 1], [1, 3]]',
    expectedDomain: 'math', difficulty: 'easy' },
  { prompt: 'Evaluate the definite integral of sin(x) from 0 to pi',
    expectedDomain: 'math', difficulty: 'easy' },
  { prompt: 'If I double the radius of a circle, by what factor does the area increase?',
    expectedDomain: 'math', difficulty: 'hard' },
  { prompt: 'What is the minimum number of moves for a knight to reach the opposite corner of an 8x8 board?',
    expectedDomain: 'math', difficulty: 'hard' },

  // ── math_reasoning (4) — easy: step-by-step / word problem phrases; hard: pure reasoning scenario ──
  { prompt: 'A store sells 3 items at $4 each and 5 items at $7 each. Show step by step how to find the total revenue',
    expectedDomain: 'math_reasoning', difficulty: 'easy' },
  { prompt: 'There are 8 runners in a race. How many ways can first, second, and third place be awarded?',
    expectedDomain: 'math_reasoning', difficulty: 'easy' },
  { prompt: 'A pipe fills a tank in 4 hours and another drains it in 6 hours. If both are open, when is the tank full?',
    expectedDomain: 'math_reasoning', difficulty: 'hard' },
  { prompt: 'Two towns are 120 miles apart. A car leaves each town towards the other at the same time at different speeds. Where do they meet?',
    expectedDomain: 'math_reasoning', difficulty: 'hard' },

  // ── creative (5) — easy: write+form keywords; hard: implicit creative request ──
  { prompt: 'Write a short story about a retired astronaut who starts receiving messages from her old spacecraft',
    expectedDomain: 'creative', difficulty: 'easy' },
  { prompt: 'Compose a haiku capturing the exact moment just before a thunderstorm breaks',
    expectedDomain: 'creative', difficulty: 'easy' },
  { prompt: 'Draft a dialogue between a museum painting and the last visitor before closing time',
    expectedDomain: 'creative', difficulty: 'easy' },
  { prompt: 'Give me something that captures the strange loneliness of being the only person awake in a sleeping house',
    expectedDomain: 'creative', difficulty: 'hard' },
  { prompt: 'Tell me a tale about a cartographer who discovers her maps are changing overnight',
    expectedDomain: 'creative', difficulty: 'hard' },

  // ── general (5) — easy: clear factual Q&A; hard: nuanced questions that could confuse other domains ──
  { prompt: 'What is the capital of Argentina and what is it most famous for?',
    expectedDomain: 'general', difficulty: 'easy' },
  { prompt: 'Who was Ada Lovelace and why is she significant in the history of computing?',
    expectedDomain: 'general', difficulty: 'easy' },
  { prompt: 'What causes the Northern Lights and where is the best place to see them?',
    expectedDomain: 'general', difficulty: 'easy' },
  { prompt: 'Why do some countries drive on the left side of the road?',
    expectedDomain: 'general', difficulty: 'hard' },
  { prompt: 'How does the economy of a country recover after a major natural disaster?',
    expectedDomain: 'general', difficulty: 'hard' },

  // ── general_chat (4) — easy: greeting openers; hard: casual conversation without greeting ──
  { prompt: 'Hi! I just wanted to say your explanations have been really helpful, thank you',
    expectedDomain: 'general_chat', difficulty: 'easy' },
  { prompt: 'Hey, quick question — do you have a favourite type of music?',
    expectedDomain: 'general_chat', difficulty: 'easy' },
  { prompt: 'I have been thinking about picking up a new hobby, any thoughts on what might be fun?',
    expectedDomain: 'general_chat', difficulty: 'hard' },
  { prompt: 'Can you recommend something good to watch this weekend? I am in the mood for something surprising',
    expectedDomain: 'general_chat', difficulty: 'hard' },

  // ── research (5) — easy: research/journal/compare keywords; hard: analytical without vocabulary ──
  { prompt: 'Summarize the current research on the effects of sleep deprivation on cognitive performance',
    expectedDomain: 'research', difficulty: 'easy' },
  { prompt: 'What does the peer-reviewed literature say about the long-term effectiveness of mindfulness therapy?',
    expectedDomain: 'research', difficulty: 'easy' },
  { prompt: 'Compare and analyze the evidence for and against intermittent fasting as a weight-loss intervention',
    expectedDomain: 'research', difficulty: 'easy' },
  { prompt: 'What do we know about why some cities successfully reduced car usage and others failed despite similar policies?',
    expectedDomain: 'research', difficulty: 'hard' },
  { prompt: 'Give me a balanced look at whether remote work is genuinely more productive than office work, and what the disagreements are',
    expectedDomain: 'research', difficulty: 'hard' },

  // ── summarization (4) — easy: summarize/tldr/key points; hard: compression request without those words ──
  { prompt: 'Summarize the key points of this article: [paste long text here]',
    expectedDomain: 'summarization', difficulty: 'easy' },
  { prompt: 'Give me a TL;DR of the major events of the French Revolution in five bullet points',
    expectedDomain: 'summarization', difficulty: 'easy' },
  { prompt: 'I just sat through a two-hour meeting — can you condense these notes into the three decisions we actually made?',
    expectedDomain: 'summarization', difficulty: 'hard' },
  { prompt: 'Take this five-page contract and pull out only the parts that would affect me if I wanted to cancel early',
    expectedDomain: 'summarization', difficulty: 'hard' },

  // ── vision (4) — easy: image/photo/screenshot keywords; hard: visual analysis without those words ──
  { prompt: 'Describe what is shown in this image in as much detail as possible',
    expectedDomain: 'vision', difficulty: 'easy' },
  { prompt: 'What text can you read in this screenshot and what does the UI seem to be doing?',
    expectedDomain: 'vision', difficulty: 'easy' },
  { prompt: 'Look at this diagram and tell me whether the flow it describes makes logical sense',
    expectedDomain: 'vision', difficulty: 'hard' },
  { prompt: 'Can you identify what kind of document this appears to be and extract the key figures from it?',
    expectedDomain: 'vision', difficulty: 'hard' },

  // ── multilingual (5) — easy: translate/language keywords; hard: language-related without "translate" ──
  { prompt: 'Translate the following paragraph from English to formal Spanish',
    expectedDomain: 'multilingual', difficulty: 'easy' },
  { prompt: 'How do you say "I would like a table for two, please" in French and in Italian?',
    expectedDomain: 'multilingual', difficulty: 'easy' },
  { prompt: 'What is the German word for the feeling of coziness and warmth you get from being inside on a cold day?',
    expectedDomain: 'multilingual', difficulty: 'easy' },
  { prompt: 'I am learning Japanese and struggling with the difference between は and が — can you explain it clearly?',
    expectedDomain: 'multilingual', difficulty: 'hard' },
  { prompt: 'Why do some languages have gendered nouns and others do not — is there a historical explanation?',
    expectedDomain: 'multilingual', difficulty: 'hard' },

];
