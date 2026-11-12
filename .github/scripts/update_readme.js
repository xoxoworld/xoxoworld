const fs = require("fs");
const path = require("path");

/**
 * Recent Activity updater
 *
 * Older versions only read `GET /users/:user/events`, which is limited to the
 * public event stream (delayed, capped at 90 days, and pushes are collapsed).
 * This version combines two sources so the section reflects the latest commits
 * even when the event stream lags behind:
 *
 *   1. `GET /search/commits?q=author:<user>&sort=author-date&order=desc`
 *      -> newest commits across every repository (grouped per repo & day)
 *   2. `GET /users/:user/events`
 *      -> non-push activity (PRs, issues, reviews, new repos)
 *
 * Both sources are merged, de-duplicated and sorted newest first.
 */

const USERNAME = "xoxoworld";
const MAX_LINES = 6;
const TIME_ZONE = "Asia/Seoul";
const COMMITS_PER_PAGE = 100;

const TOKEN = process.env.ACTIVITY_TOKEN || process.env.GITHUB_TOKEN;

function headers() {
  const h = {
    "User-Agent": "xoxoworld-readme-updater",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}

async function getJSON(url) {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function dayKey(isoDate) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoDate));
}

function koDate(isoDate) {
  return new Date(isoDate).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TIME_ZONE,
  });
}

function cleanMessage(message, max = 80) {
  const firstLine = (message || "").split("\n")[0].trim();
  const safe = firstLine
    .replace(/`/g, "'")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ");
  return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe;
}

function pluralCommits(count) {
  return count > 1 ? `${count}개 커밋` : "1개 커밋";
}

/** Newest commits, grouped per repository + day so a burst of pushes reads as one line. */
async function commitActivities() {
  const url =
    `https://api.github.com/search/commits?q=${encodeURIComponent(`author:${USERNAME}`)}` +
    `&sort=author-date&order=desc&per_page=${COMMITS_PER_PAGE}`;
  const data = await getJSON(url);
  const items = data.items || [];

  const groups = new Map();
  for (const item of items) {
    const iso = item.commit?.author?.date || item.commit?.committer?.date;
    if (!iso) continue;
    const fullName = item.repository?.full_name || "";
    if (!fullName) continue;
    const key = `${fullName}|${dayKey(iso)}`;
    const message = cleanMessage(item.commit?.message, 64);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.messages.length < 3 && message && !existing.messages.includes(message)) {
        existing.messages.push(message);
      }
      continue;
    }
    groups.set(key, {
      ts: Date.parse(iso),
      repo: fullName,
      date: koDate(iso),
      messages: message ? [message] : [],
      count: 1,
    });
  }

  return [...groups.values()].map((g) => {
    const shortName = g.repo.split("/")[1];
    const repoUrl = `https://github.com/${g.repo}`;
    const snippet = g.messages.length
      ? ` — ${g.messages.map((m) => `*"${m}"*`).join(" · ")}`
      : "";
    return {
      ts: g.ts,
      text: `🔨 [\`${shortName}\`](${repoUrl}/commits)에 **${pluralCommits(g.count)}** 푸시${snippet} (${g.date})`,
    };
  });
}

/** PR / issue / review / new-repo events. Pushes are covered by commitActivities(). */
async function eventActivities() {
  const url = `https://api.github.com/users/${USERNAME}/events?per_page=50`;
  const events = await getJSON(url);
  const lines = [];
  const seen = new Set();

  for (const event of events) {
    const repoName = event.repo?.name || "";
    if (!repoName) continue;
    const shortRepoName = repoName.split("/")[1];
    const repoUrl = `https://github.com/${repoName}`;
    const eventTime = koDate(event.created_at);
    let activityText = "";

    if (event.type === "CreateEvent" && event.payload?.ref_type === "repository") {
      activityText = `🚀 새 저장소 [**${shortRepoName}**](${repoUrl}) 생성 (${eventTime})`;
    } else if (event.type === "PullRequestEvent" && event.payload?.action === "opened") {
      const prNumber = event.payload.number;
      const prUrl = event.payload.pull_request?.html_url || `${repoUrl}/pull/${prNumber}`;
      const prTitle = event.payload.pull_request?.title || "";
      const titleSnippet = prTitle ? ` — *"${cleanMessage(prTitle)}"*` : "";
      activityText = `🔀 [**${shortRepoName}**](${repoUrl})에 PR [#${prNumber}](${prUrl}) 오픈${titleSnippet} (${eventTime})`;
    } else if (
      event.type === "PullRequestEvent" &&
      event.payload?.action === "closed" &&
      event.payload?.pull_request?.merged
    ) {
      const prNumber = event.payload.number;
      const prUrl = event.payload.pull_request?.html_url || `${repoUrl}/pull/${prNumber}`;
      const prTitle = event.payload.pull_request?.title || "";
      const titleSnippet = prTitle ? ` — *"${cleanMessage(prTitle)}"*` : "";
      activityText = `🎉 [**${shortRepoName}**](${repoUrl})의 PR [#${prNumber}](${prUrl}) 병합${titleSnippet} (${eventTime})`;
    } else if (event.type === "PullRequestReviewEvent") {
      const prNumber = event.payload?.pull_request?.number;
      const prUrl = event.payload?.pull_request?.html_url || `${repoUrl}/pull/${prNumber}`;
      const prTitle = event.payload?.pull_request?.title || "";
      const titleSnippet = prTitle ? ` — *"${cleanMessage(prTitle)}"*` : "";
      const key = `review-${repoName}-${prNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      activityText = `👀 [**${shortRepoName}**](${repoUrl})의 PR [#${prNumber}](${prUrl}) 코드 리뷰${titleSnippet} (${eventTime})`;
    } else if (event.type === "IssuesEvent" && event.payload?.action === "opened") {
      const issueNumber = event.payload.issue?.number;
      const issueUrl = event.payload.issue?.html_url || `${repoUrl}/issues/${issueNumber}`;
      const issueTitle = event.payload.issue?.title || "";
      const titleSnippet = issueTitle ? ` — *"${cleanMessage(issueTitle)}"*` : "";
      activityText = `🗣️ [**${shortRepoName}**](${repoUrl})에 이슈 [#${issueNumber}](${issueUrl}) 생성${titleSnippet} (${eventTime})`;
    }

    if (activityText) {
      lines.push({ ts: Date.parse(event.created_at), text: activityText });
    }
  }

  return lines;
}

function dedupe(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    if (seen.has(line.text)) continue;
    seen.add(line.text);
    out.push(line);
  }
  return out;
}

async function main() {
  try {
    /* Fetch both sources independently: one failing must not blank the section. */
    const [commits, events] = await Promise.all([
      commitActivities().catch((error) => {
        console.error(`[warn] commit search failed: ${error.message}`);
        return [];
      }),
      eventActivities().catch((error) => {
        console.error(`[warn] event stream failed: ${error.message}`);
        return [];
      }),
    ]);

    if (commits.length === 0 && events.length === 0) {
      throw new Error("Both activity sources returned nothing");
    }

    const activityLines = dedupe([...commits, ...events])
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_LINES)
      .map((line) => line.text);

    if (activityLines.length === 0) {
      activityLines.push("💤 최근 공개 활동이 없습니다.");
    }

    const readmePath = path.join(__dirname, "../../README.md");
    let readmeContent = fs.readFileSync(readmePath, "utf8");

    const startTag = "<!-- START_SECTION:activity -->";
    const endTag = "<!-- END_SECTION:activity -->";

    const startIdx = readmeContent.indexOf(startTag);
    const endIdx = readmeContent.indexOf(endTag);

    if (startIdx === -1 || endIdx === -1) {
      throw new Error("Could not find activity section tags in README.md");
    }

    const before = readmeContent.substring(0, startIdx + startTag.length);
    const after = readmeContent.substring(endIdx);
    const newActivity = "\n\n" + activityLines.map((line) => `- ${line}`).join("\n") + "\n\n";

    const newReadmeContent = before + newActivity + after;
    if (newReadmeContent !== readmeContent) {
      fs.writeFileSync(readmePath, newReadmeContent, "utf8");
      console.log("README.md updated successfully!");
    } else {
      console.log("README.md already up to date.");
    }
    activityLines.forEach((line) => console.log(`  - ${line}`));
  } catch (error) {
    console.error("Error updating README:", error);
    process.exit(1);
  }
}

main();
