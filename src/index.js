const core = require("@actions/core");
const github = require("@actions/github");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const isAffected = async (pck, workflows, owner, repo, branch, octokit) => {
  const allRuns = await Promise.all(
    workflows.map((workflow) => {
      console.log(`retrieving last successful run for ${workflow}...`);
      return octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflow,
        status: "success",
        branch,
      });
    })
  );

  for (const runs of allRuns) {
    if (runs.data.workflow_runs.length === 0) {
      console.log("no successful runs found, package is affected");
      return true;
    }
    const lastRun = runs.data.workflow_runs[0];
    console.log(
      `checking if package has changed since last successful run ${lastRun}...`
    );

    const sanitizedPackage = pck.replaceAll(/["'\\`]/g, "");

    const { stdout } = await exec(
      `npx turbo run test --filter='${sanitizedPackage}...[HEAD...${lastRun.head_commit.id}]' --dry=json`
    );

    const result = JSON.parse(stdout);

    console.log(
      `checking if package "${pck}" is in affected packages: "${
        result?.packages || []
      }"`
    );

    if (result?.packages?.contains(pck)) {
      return true;
    }
  }
  return false;
};

const run = async () => {
  let mapping = core.getInput("nameToWorkflowMapping");
  // GitHub Actions escapes user input so we need to unescape it
  mapping = mapping
    .replaceAll(/\\"/g, '"') // replace escaped quotes
    .replaceAll(/\\n/g, "\n") // replace escaped newlines
    .slice(1, -1); // remove quotes

  const branch = core.getInput("branch");
  const octokit = github.getOctokit(core.getInput("github_token"));
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

  let mappedWorkflows = {};

  try {
    mappedWorkflows = JSON.parse(mapping);
    console.log({ mappedWorkflows, mapping });
  } catch (e) {
    core.setFailed(`Failed to parse nameToWorkflowMapping: ${e}`);
    return;
  }

  console.log("starting to check affected packages...");

  try {
    const results = await Promise.all(
      Object.entries(mappedWorkflows).map(async ([name, workflow]) => {
        let workflowsArray = workflow;
        if (!Array.isArray(workflow)) {
          if (typeof workflow === "string" && workflow.length > 0) {
            workflowsArray = [workflow];
            console.log(
              `${workflow} is not an array, but a string. Converting to array...`
            );
          } else {
            core.setFailed(
              "Workflow mapping must be a string or an array of strings"
            );
            system.exit(1);
            return;
          }
        }
        if (
          await isAffected(name, workflowsArray, owner, repo, branch, octokit)
        ) {
          return name;
        }
      })
    );
    core.setOutput(
      "affectedPackages",
      JSON.stringify(results.filter((r) => r))
    );
  } catch (e) {
    core.setFailed(`Failed to check affected packages: ${e}`);
    return;
  }
};

run();
