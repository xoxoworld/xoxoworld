const fs = require("fs");
const path = require("path");

async function main() {
  try {
    const username = "xoxoworld";
    // A Personal Access Token (PAT) is optional but recommended to avoid rate limits and fetch private activity.
    const token = process.env.ACTIVITY_TOKEN || process.env.GITHUB_TOKEN;

    const headers = {
      "User-Agent": "xoxoworld-readme-updater",
    };
    
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    const response = await fetch(`https://api.github.com/users/${username}/events`, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`);
    }

    const events = await response.json();
    const activityLines = [];
    const seenActivities = new Set(); // to avoid duplicate consecutive messages

    for (const event of events) {
      if (activityLines.length >= 6) break;

      const repoName = event.repo.name;
      const shortRepoName = repoName.split("/")[1];
      const repoUrl = `https://github.com/${repoName}`;
      const eventTime = new Date(event.created_at).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      let activityText = "";

      if (event.type === "PushEvent") {
        const branch = (event.payload.ref || "").replace("refs/heads/", "");
        if (!branch) continue;

        // Skip if we already logged a push to this repo & branch recently
        const key = `push-${repoName}-${branch}-${eventTime}`;
        if (seenActivities.has(key)) continue;
        seenActivities.add(key);

        const commits = event.payload.commits || [];
        if (commits.length > 0) {
          const commitCount = commits.length;
          const commitMsg = commits[0].message.split("\n")[0] || "";
          const commitLabel = commitCount > 1 ? `${commitCount}개 커밋` : "1개 커밋";
          activityText = `🔨 [\`${shortRepoName}/${branch}\`](${repoUrl}/tree/${branch})에 **${commitLabel}** 푸시 — *"${commitMsg}"* (${eventTime})`;
        } else {
          activityText = `🔨 [\`${shortRepoName}/${branch}\`](${repoUrl}/tree/${branch})에 커밋 푸시 (${eventTime})`;
        }
      } else if (event.type === "CreateEvent" && event.payload.ref_type === "repository") {
        activityText = `🚀 새 저장소 [**${shortRepoName}**](${repoUrl}) 생성 (${eventTime})`;
      } else if (event.type === "PullRequestEvent" && event.payload.action === "opened") {
        const prNumber = event.payload.number;
        const prUrl = event.payload.pull_request?.html_url || `${repoUrl}/pull/${prNumber}`;
        const prTitle = event.payload.pull_request?.title || "";
        const titleSnippet = prTitle ? ` — *"${prTitle}"*` : "";
        activityText = `🔀 [**${shortRepoName}**](${repoUrl})에 PR [#${prNumber}](${prUrl}) 오픈${titleSnippet} (${eventTime})`;
      } else if (
        event.type === "PullRequestEvent" &&
        event.payload.action === "closed" &&
        event.payload.pull_request?.merged
      ) {
        const prNumber = event.payload.number;
        const prUrl = event.payload.pull_request?.html_url || `${repoUrl}/pull/${prNumber}`;
        const prTitle = event.payload.pull_request?.title || "";
        const titleSnippet = prTitle ? ` — *"${prTitle}"*` : "";
        activityText = `🎉 [**${shortRepoName}**](${repoUrl})의 PR [#${prNumber}](${prUrl}) 병합${titleSnippet} (${eventTime})`;
      } else if (event.type === "PullRequestReviewEvent") {
        const prNumber = event.payload.pull_request?.number;
        const prUrl = event.payload.pull_request?.html_url || `${repoUrl}/pull/${prNumber}`;
        const prTitle = event.payload.pull_request?.title || "";
        const titleSnippet = prTitle ? ` — *"${prTitle}"*` : "";
        const key = `review-${repoName}-${prNumber}`;
        if (seenActivities.has(key)) continue;
        seenActivities.add(key);
        activityText = `👀 [**${shortRepoName}**](${repoUrl})의 PR [#${prNumber}](${prUrl}) 코드 리뷰${titleSnippet} (${eventTime})`;
      } else if (event.type === "IssuesEvent" && event.payload.action === "opened") {
        const issueNumber = event.payload.issue?.number;
        const issueUrl = event.payload.issue?.html_url || `${repoUrl}/issues/${issueNumber}`;
        const issueTitle = event.payload.issue?.title || "";
        const titleSnippet = issueTitle ? ` — *"${issueTitle}"*` : "";
        activityText = `🗣️ [**${shortRepoName}**](${repoUrl})에 이슈 [#${issueNumber}](${issueUrl}) 생성${titleSnippet} (${eventTime})`;
      }

      if (activityText) {
        activityLines.push(activityText);
      }
    }

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
    const newActivity = "\n\n" + activityLines.map(line => `- ${line}`).join("\n") + "\n\n";

    const newReadmeContent = before + newActivity + after;
    fs.writeFileSync(readmePath, newReadmeContent, "utf8");
    console.log("README.md updated successfully!");
  } catch (error) {
    console.error("Error updating README:", error);
    process.exit(1);
  }
}

main();
