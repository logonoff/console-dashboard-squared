/** JIRA / OCPBUGS field IDs verified via Atlassian MCP against redhat.atlassian.net */

export const JIRA = {
  cloudId: "2b9e35e3-6bd3-4cec-b838-f4249ee02432",
  siteUrl: "https://redhat.atlassian.net",

  project: {
    key: "OCPBUGS",
    id: "10325",
  },

  issueType: {
    bug: { id: "10016", name: "Bug" },
  },

  fields: {
    /** Target Version (array of version objects) */
    targetVersion: "customfield_10855",
    /** Release Blocker */
    releaseBlocker: "customfield_10847",
  },

  components: {
    managementConsole: { id: "14749", name: "Management Console" },
  },

  labels: {
    automated: "automated",
    ciWatch: "ci-watch",
  },
} as const;
