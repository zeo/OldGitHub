import { searchIssues, type IssueResult } from "./search";

export type MeIssueKind = "issue" | "pull";
export type MeIssueFilter = "created" | "assigned" | "mentioned" | "review-requested";

export type MeIssuesPage = {
  kind: MeIssueKind;
  filter: MeIssueFilter;
  login: string | null;
  query: string;
  totalCount: number;
  items: IssueResult[];
};

const QUALIFIER: Record<MeIssueFilter, string> = {
  created: "author",
  assigned: "assignee",
  mentioned: "mentions",
  "review-requested": "review-requested",
};

export async function getMeIssues(kind: MeIssueKind, filter: MeIssueFilter, login: string | null): Promise<MeIssuesPage> {
  if (!login) {
    return { kind, filter, login, query: "", totalCount: 0, items: [] };
  }
  const query = `is:open archived:false ${QUALIFIER[filter]}:${login}`;
  const { summary, items } = await searchIssues(query, "updated", "desc", kind === "pull", 1);
  return { kind, filter, login, query, totalCount: summary.totalCount, items };
}
