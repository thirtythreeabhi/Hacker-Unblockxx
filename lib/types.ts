export type Difficulty = 1 | 2 | 3 | null;

export type IndexedContent = {
  contentId: string;
  problemId: string | null;
  name: string;
  difficulty: Difficulty;
  type: string | null;
  verified: boolean;
};

export type IndexedContest = {
  contestId: string;
  contestName: string;
  status: number | null;
  contentCount: number;
  contents: IndexedContent[];
  description?: string;
  kind?: string;
  domain?: string;
  topics?: string[];
  primaryTopics?: string[];
  course?: string | null;
  batch?: string | null;
  location?: string | null;
  instructor?: string | null;
  institution?: string | null;
  year?: number | null;
  difficultyProfile?: string;
  languages?: string[];
  tags?: string[];
  confidence?: number;
  sourceQuality?: string;
  model?: string;
  generatedAt?: string;
};

export type IndexData = {
  generatedAt: string;
  stats: {
    contests: number;
    accessibleContests: number;
    deniedContests: number;
    memberships: number;
    uniqueContents: number;
    uniqueProblems: number;
    malformedLines: number;
  };
  contests: IndexedContest[];
};

export type SolutionStub = {
  language: string;
  body: string;
};

export type Question = {
  contentId: string;
  problemId: string | null;
  name: string;
  difficulty: Difficulty;
  description: string | null;
  constraints: string | null;
  inputFormat: string | null;
  outputFormat: string | null;
  sampleInput: string | null;
  sampleOutput: string | null;
  explanation: string | null;
  problemType: string | null;
  status: string | null;
  solutionStubs: SolutionStub[];
};

export type ProblemSearchResult = {
  problemId: string;
  contentId: string | null;
  contestId: string | null;
  name: string;
  difficulty: Difficulty;
  topics: string[];
  primaryTopics: string[];
  domain: string | null;
  similarity: number;
  completed?: boolean;
  bookmarked?: boolean;
};
