/** URL builders for dptools, spyglass, and JIRA. */

/**
 * dptools CI search URL for a specific test suite and job.
 *
 * maxAge is in hours (windowDays * 24).
 */
export function dptoolsUrl(opts: {
  searchTerm: string;
  jobName: string;
  windowDays: number;
}): string {
  const params = new URLSearchParams({
    search: opts.searchTerm,
    maxAge: `${opts.windowDays * 24}h`,
    context: "1",
    type: "junit",
    name: opts.jobName,
    excludeName: "",
    maxMatches: "5",
    maxBytes: "20971520",
    groupBy: "job",
  });
  return `https://search.dptools.openshift.org/?${params}`;
}

/** JIRA issue search URL with a pre-built JQL. */
export function jiraSearchUrl(jql: string): string {
  return `https://redhat.atlassian.net/issues/?jql=${encodeURIComponent(jql)}`;
}
