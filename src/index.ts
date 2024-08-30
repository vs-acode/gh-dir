import {
    getDirectoryContentViaContentsApi,
    getDirectoryContentViaTreesApi,
    type ListGithubDirectoryOptions,
    type TreeResponseObject,
    type ContentsReponseObject,
} from "list-github-dir-content";
import pMap from "p-map";
import { downloadFile } from "./download.js";
import getRepositoryInfo from "./repository-info.js";
import * as fs from "fs";
import * as pth from "path";
import { style } from "ziyy";

type ApiOptions = ListGithubDirectoryOptions & { getFullData: true };

function isError(error: unknown): error is Error {
    return error instanceof Error;
}

async function listFiles(
    repoListingConfig: ApiOptions
): Promise<Array<TreeResponseObject | ContentsReponseObject>> {
    const files = await getDirectoryContentViaTreesApi(repoListingConfig);

    if (!files.truncated) {
        return files;
    }

    updateStatus(
        'Warning: It’s a large repo and this it take a long while just to download the list of files. You might want to use "git sparse checkout" instead.'
    );
    return getDirectoryContentViaContentsApi(repoListingConfig);
}

function updateStatus(status?: string, ...extra: unknown[]) {
    /* const element = document.querySelector('.status')!;
	if (status) {
		const wrapper = document.createElement('div');
		wrapper.textContent = status;
		element.prepend(wrapper);
	} else {
		element.textContent = status ?? '';
	} */

    console.log(style(status!), ...extra);
}

const googleDoesntLikeThis = /malware|virus|trojan/i;

function writeFile(path: string, content: string | NodeJS.ArrayBufferView) {
    let parent = pth.dirname(path);
    if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(path, content, { mode: 0o666 });
}

async function init(url: string, path: string, token: string | null) {
    let input: { value?: string } = {};

    if (token) {
        input.value = token;
    }

    if (googleDoesntLikeThis.test(url)) {
        updateStatus("<c.red>Virus, malware, trojans are not allowed");
        return;
    }

    const parsedPath = await getRepositoryInfo(url, token);

    if ("error" in parsedPath) {
        // eslint-disable-next-line unicorn/prefer-switch -- I hate how it looks
        if (parsedPath.error === "NOT_A_REPOSITORY") {
            updateStatus("<c.red>⚠ Not a repository");
        } else if (parsedPath.error === "NOT_A_DIRECTORY") {
            updateStatus("<c.red>⚠ Not a directory");
        } else if (parsedPath.error === "REPOSITORY_NOT_FOUND") {
            updateStatus(
                "<c.red>⚠ Repository not found. If it’s private, you should enter a token that can access it."
            );
        } else {
            updateStatus("<c.red>⚠ Unknown error");
        }

        return;
    }

    const { user, repository, gitReference, directory, isPrivate } = parsedPath;
    updateStatus(`Repo: ${user}/${repository}\nDirectory: /${directory}`, {
        source: {
            user,
            repository,
            gitReference,
            directory,
            isPrivate,
        },
    });

    if ("downloadUrl" in parsedPath) {
        updateStatus("<c.blue>Downloading the entire repository directly from GitHub");
    }

    updateStatus("<c.blue>Retrieving directory info");

    const files = await listFiles({
        user,
        repository,
        ref: gitReference,
        directory,
        token: token ?? undefined,
        getFullData: true,
    });

    if (files.length === 0) {
        updateStatus("<c.red>No files to download");
        return;
    }

    if (files.some((file) => googleDoesntLikeThis.test(file.path))) {
        updateStatus("<c.red>Virus, malware, trojans are not allowed");
        return;
    }

    updateStatus(`<c.blue>Will download ${files.length} files`);

    const controller = new AbortController();
    const signal = controller.signal;

    let downloaded = 0;

    try {
        await pMap(
            files,
            async (file) => {
                const text = downloadFile({
                    user,
                    repository,
                    reference: gitReference!,
                    file,
                    isPrivate,
                    signal,
                    token,
                });

                downloaded++;
                updateStatus(`<c.blue>Downloading ${file.path.replace(directory + "/", "")}...`);

                writeFile(file.path.replace(directory, path), await text);
            },
            { concurrency: 20 }
        );
    } catch (error) {
        controller.abort();

        if (isError(error) && error.message.startsWith("HTTP ")) {
            updateStatus("<c.red>⚠ Could not download all files.");
        } else {
            updateStatus("<c.red>⚠ Some files were blocked from downloading.");
        }

        throw error;
    }

    updateStatus(`<c.green>Saved files to ${path}! Done!`);
}

export function run(url: string, path: string, token: string | null) {
    // eslint-disable-next-line unicorn/prefer-top-level-await -- Not allowed
    void init(url, path, token).catch((error) => {
        if (error instanceof Error) {
            switch (error.message) {
                case "Invalid token": {
                    updateStatus(
                        "<c.red>⚠ The token provided is invalid or has been revoked.",
                        {
                            token: token,
                        }
                    );
                    break;
                }

                case "Rate limit exceeded": {
                    updateStatus(
                        "<c.red>⚠ Your token rate limit has been exceeded. Please wait or add a token",
                        { token: token }
                    );
                    break;
                }

                default: {
                    updateStatus(`<c.red>⚠ ${error.message}`, error);
                    break;
                }
            }
        }
    });
}
