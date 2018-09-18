export const argsSymbol = Symbol("args");

export interface Options {
  [argsSymbol]: string[];

  [name: string]: string | true;
}

export class OptionError extends Error {}

export function parseOptions(args = process.argv.slice(2)) {
  const options: Options = {
    [argsSymbol]: [],
  };

  let optionName: string | undefined;
  while (args.length) {
    const arg = args.shift()!;
    if (arg.startsWith("--")) {
      if (optionName) {
        options[optionName] = true;
      }
      optionName = arg.slice(2);
      if (!optionName) {
        options[argsSymbol].push(...args);
        break;
      }
    } else {
      if (optionName) {
        options[optionName] = arg;
        optionName = undefined;
      } else {
        options[argsSymbol].push(arg);
      }
    }
  }

  if (optionName) {
    options[optionName] = true;
  }

  return options;
}

export function getOption<T = never>(
  options: Options,
  name: string,
  defaultValue?: T,
): Options[string] | T {
  const value = options[name];
  delete options[name];
  if (typeof value !== "undefined") {
    return value;
  }
  if (typeof defaultValue !== "undefined") {
    return defaultValue;
  }
  throw new OptionError(`--${name} is required`);
}

export function getStringOption<T = never>(
  options: Options,
  name: string,
  defaultValue?: T,
): string | T {
  const value = getOption(options, name, defaultValue);
  if (value === true) {
    throw new OptionError(`--${name} requires a value`);
  }
  return value;
}

export function getFlagOption(options: Options, name: string): boolean {
  const value = getOption(options, name, false);
  if (typeof value === "string") {
    throw new OptionError(`--${name} does not have a value`);
  }
  return value;
}

export function checkForUnknownOptions(options: Options) {
  if (Object.keys(options).length) {
    const unknownArgString = Object.keys(options)
      .map(name => `--${name}`)
      .join(" ");
    throw new OptionError(`Unknown option(s): ${unknownArgString}`);
  }
  if (options[argsSymbol].length) {
    throw new OptionError(`Unhandled args: ${options[argsSymbol].join(" ")}`);
  }
}
