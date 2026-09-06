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
