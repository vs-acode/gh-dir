import authenticatedFetch from "./authenticated-fetch.js";

function cleanUrl(url: string) {
    return url
        .replace(/[/]{2,}/, "/") // Drop double slashes
        .replace(/[/]$/, ""); // Drop trailing slash
}

async function parsePath(
    user: string,
    repo: string,
    parts: string[],
    token: string | null
): Promise<{ gitReference: string; directory: string } | void> {
    for (let i = 0; i < parts.length; i++) {
        const gitReference = parts.slice(0, i + 1).join("/");
        // eslint-disable-next-line no-await-in-loop -- One at a time
        if (await checkBranchExists(user, repo, gitReference, token)) {
            return {
                gitReference,
                directory: parts.slice(i + 1).join("/"),
            };
        }
    }
}

export default async function getRepositoryInfo(
    url: string,
    token: string | null
): Promise<
    | { error: string }
    | {
          user: string;
          repository: string;
          gitReference?: string;
          directory: string;
          downloadUrl: string;
          isPrivate: boolean;
      }
    | {
          user: string;
          repository: string;
          gitReference: string;
          directory: string;
          isPrivate: boolean;
      }
> {
    const [, user, repository, type, ...parts] = cleanUrl(
        decodeURIComponent(new URL(url).pathname)
    ).split("/");

    if (!user || !repository) {
        return { error: "NOT_A_REPOSITORY" };
    }

    if (type && type !== "tree") {
        return { error: "NOT_A_DIRECTORY" };
    }

    const repoInfoResponse = await authenticatedFetch(
        `https://api.github.com/repos/${user}/${repository}`,
        token
    );

    if (repoInfoResponse.status === 404) {
        return { error: "REPOSITORY_NOT_FOUND" };
    }

    const { private: isPrivate } = (await repoInfoResponse.json()) as {
        private: boolean;
    };

    if (parts.length === 0) {
        return {
            user,
            repository,
            directory: "",
            isPrivate,
            downloadUrl: `https://api.github.com/repos/${user}/${repository}/zipball`,
        };
    }

    if (parts.length === 1) {
        return {
            user,
            repository,
            gitReference: parts[0],
            directory: "",
            isPrivate,
            downloadUrl: `https://api.github.com/repos/${user}/${repository}/zipball/${parts[0]}`,
        };
    }

    const parsedPath = await parsePath(user, repository, parts, token);
    if (!parsedPath) {
        return { error: "BRANCH_NOT_FOUND" };
    }

    return {
        user,
        repository,
        isPrivate,
        ...parsedPath,
    };
}

async function checkBranchExists(
    user: string,
    repo: string,
    gitReference: string,
    token: string | null
): Promise<boolean> {
    const apiUrl = `https://api.github.com/repos/${user}/${repo}/commits/${gitReference}?per_page=1`;
    const response = await authenticatedFetch(apiUrl, token, {
        method: "HEAD",
    });
    return response.ok;
}
