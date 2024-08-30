import { run } from "../index.js";
import * as pth from "path";

let args = process.argv.slice(2);
if (args[0] == "clone") args.shift();
let url = args[0];
let path = pth.resolve(args[1]!);
let token = args[2];
run(url!, path, token!);