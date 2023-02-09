const core = require("@actions/core");
const github = require("@actions/github");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const isAffected = async (pck, workflow, owner, repo, branch, octokit) => {
  const runs = await octokit.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: workflow,
    status: "success",
    branch,
  });
  if (runs.data.workflow_runs.length === 0) {
    return true;
  }
  const lastRun = runs.data.workflow_runs[0];

  const sanitizedPackage = pck.replaceAll(/["'\\`]/);

  const { stdout } = await exec(
    `npx turbo run test --filter='${sanitizedPackage}...[HEAD...${lastRun.head_commit.id}]' --dry=json`
  );

  const result = JSON.parse(stdout);

  return result.packages.contains(pck);
};

const run = async () => {
  const mapping = core.getInput("nameToWorkflowMapping");
  const branch = core.getInput("branch");
  const octokit = github.getOctokit(core.getInput("github_token"));
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

  let mappedWorkflows = {};

  try {
    mappedWorkflows = JSON.parse(mapping);
  } catch (e) {
    core.setFailed(`Failed to parse nameToWorkflowMapping: ${e}`);
    return;
  }

  try {
    const results = await Promise.all(
      Object.entries(mappedWorkflows).map(([name, workflow]) =>
        isAffected(name, workflow, owner, repo, branch, octokit)
      )
    );
    core.setOutput("affectedPackages", JSON.stringify(results));
  } catch (e) {
    core.setFailed(`Failed to check affected packages: ${e}`);
    return;
  }
};
