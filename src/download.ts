import {
    type ContentsReponseObject,
    type TreeResponseObject,
} from "list-github-dir-content";
import pRetry, { type FailedAttemptError } from "p-retry";
import authenticatedFetch from "./authenticated-fetch.js";
import { style } from "ziyy";

function escapeFilepath(path: string) {
    return path.replaceAll("#", "%23");
}

async function maybeResponseLfs(response: Response): Promise<boolean> {
    const length = Number(response.headers.get("content-length"));
    if (length > 128 && length < 140) {
        const contents = await response.clone().text();
        return contents.startsWith(
            "version https://git-lfs.github.com/spec/v1"
        );
    }

    return false;
}

type FileRequest = {
    user: string;
    repository: string;
    reference: string;
    file: TreeResponseObject | ContentsReponseObject;
    signal: AbortSignal;
};

async function fetchPublicFile({
    user,
    repository,
    reference,
    file,
    signal,
    token,
}: FileRequest & { token: string | null }) {
    const response = await authenticatedFetch(
        `https://raw.githubusercontent.com/${user}/${repository}/${reference}/${escapeFilepath(
            file.path
        )}`,
        token,
        { signal }
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.statusText} for ${file.path}`);
    }

    const lfsCompatibleResponse = (await maybeResponseLfs(response))
        ? await authenticatedFetch(
              `https://media.githubusercontent.com/media/${user}/${repository}/${reference}/${escapeFilepath(
                  file.path
              )}`,
              token,
              { signal }
          )
        : response;

    if (!response.ok) {
        throw new Error(`HTTP ${response.statusText} for ${file.path}`);
    }

    return lfsCompatibleResponse.text();
}

async function fetchPrivateFile({
    file,
    signal,
    token,
}: FileRequest & { token: string | null }) {
    const response = await authenticatedFetch(file.url, token, { signal });

    if (!response.ok) {
        throw new Error(`HTTP ${response.statusText} for ${file.path}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { content } = (await response.json()) as any;
    const decoder = await fetch(
        `data:application/octet-stream;base64,${content}`
    );
    return decoder.text();
}

export async function downloadFile({
    user,
    repository,
    reference,
    file,
    isPrivate,
    signal,
    token,
}: {
    user: string;
    repository: string;
    reference: string;
    isPrivate: boolean;
    file: TreeResponseObject | ContentsReponseObject;
    signal: AbortSignal;
    token: string | null;
}): Promise<string> {
    const fileRequest = {
        user,
        repository,
        reference,
        file,
        signal,
        token,
    };
    const localDownload = async () =>
        isPrivate
            ? fetchPrivateFile(fileRequest)
            : fetchPublicFile(fileRequest);
    const onFailedAttempt = (error: FailedAttemptError) => {
        console.error(
            style(`<c.red>Error downloading ${file.path}. Attempt ${error.attemptNumber}. ${error.retriesLeft} retries left.`)
        );
    };

    return pRetry(localDownload, { onFailedAttempt });
}
