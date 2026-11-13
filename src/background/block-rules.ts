const ASSETS = "||github.githubassets.com/assets/";

// fixed ids with the tab set inside the condition: chrome tab ids run into the hundreds of millions
export function blockRules(tabIds: Iterable<number>): chrome.declarativeNetRequest.Rule[] {
  const ids = [...new Set(tabIds)].sort((a, b) => a - b);
  if (ids.length === 0) return [];
  return (["stylesheet", "script"] as const).map((type, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "block" as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      urlFilter: ASSETS,
      resourceTypes: [type as chrome.declarativeNetRequest.ResourceType],
      tabIds: ids,
      initiatorDomains: ["github.com"],
    },
  }));
}
