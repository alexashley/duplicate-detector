import * as fs from 'fs';

type AsyncOperation<T, U> = (T) => Promise<U>;
type NodeCallback<T> = (Error, T) => void;

interface Result<T> {
    value: T,
    error: Error
}

// this was a bear to write. in fairness, probably reinvented the wheel here and could have used the definition from @types/node?
const promisify = <T, U>(fn: (arg: T, cb: NodeCallback<U>) => void) => (arg: T): Promise<U> => new Promise((resolve, reject) => {
    fn(arg, (error: Error, data: U) => {
        if (error) {
            return reject(error);
        }

        return resolve(data);
    });
});

const stat = promisify<fs.PathLike, fs.Stats>(fs.stat);
const readDir = promisify<fs.PathLike, string[]>(fs.readdir);
const readFile = promisify<fs.PathLike, Buffer>(fs.readFile);

const attempt = async <T, U>(arg: T, operation: AsyncOperation<T, U>): Promise<Result<U>> => {
    let value = null;
    let error = null;

    try {
        value = await operation(arg);
    } catch (e) {
        error = e;
    }

    return {
        value,
        error
    };
};

const asyncPool = async <T, U>(inputs: T[], operation: AsyncOperation<T, U>, limit: number): Promise<Result<U>[]> => {
    let result: Result<U>[] = [];

    for (let i = 0; i < inputs.length; i += limit) {
        const batchResults = await Promise.all(
            inputs.map((input) => attempt(input, operation))
        );

        // originally, the code was result.push(batchResults) and the declaration of result was `const result = []`
        // TS didn't help, `push` is a variadic function, it doesn't take an array
        // had to annotate result, i.e., `const result: Result<U>[]`
        // so the correct code would be `result.push(...batchResults)` or just `result = result.concat(batchResults)`
        result = result.concat(batchResults);
    }

    return result;
};

const failWithMessage = (message: string): void => {
    console.error(message);
    process.exit(1);
};

(async () => {
    const directory = process.argv[2];

    if (!directory) {
        failWithMessage('Must supply directory');
    }

    const directoryStats = await stat(directory);

    if (!directoryStats.isDirectory()) {
        failWithMessage(`${directory} is not directory`);
    }

    const files = await readDir(directory);
    const filesWithPath = files.map((fileName) => `${directory}/${fileName}`);

    console.log(`Discovered ${filesWithPath.length} files in ${directory}`);

    const statResults = await asyncPool(filesWithPath, stat, 10);

    console.log('len', statResults.length);

    const errors = statResults.filter((r) => r.error);

    if (errors.length) {
        console.log('The following errors occurred while reading the directory');
        errors.forEach((error) => console.error(error));
        process.exit(1);
    }

    const filesToProcess = statResults
        .filter((r) => !r.error)
        .map((r) => r.value)
        .filter((s) => s.isFile());


})();
