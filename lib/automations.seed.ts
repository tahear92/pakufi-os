// Mirrors the actual GitHub Actions workflows for visibility in Settings —
// this table doesn't run anything itself, it's a record of what's already
// scheduled elsewhere so it shows up somewhere other than a repo you have
// to go check by hand.

export const automations = [
  {
    name: "Weekly Apollo -> Notion sync",
    schedule: "0 8 * * 2", // Tuesday 08:00 UTC — existing weekly-sync.yml
  },
  {
    name: "Sales morning run",
    schedule: "0 7,8 * * 1-5", // 9am Berlin, Mon-Fri, DST-adjusted — see sales-morning-run.yml
  },
];
