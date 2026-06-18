// tests/test_cli.mjs — CLI 인자 파서 단위 테스트 (순수 함수)
import { parseArgs } from "../cli/stella-agent.mjs";

let pass = 0, fail = 0;
function A(name, ok, extra) { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (ok || !extra ? "" : `  (${extra})`)); }

let a = parseArgs(["write", "fibonacci"]);
A("1 기본 run + 프롬프트 결합", a.cmd === "run" && a.prompt === "write fibonacci");

a = parseArgs(["--list"]);
A("2 --list", a.cmd === "list");

a = parseArgs(["--cancel", "S1"]);
A("3 --cancel <id>", a.cmd === "cancel" && a.session === "S1");

a = parseArgs(["--resume", "S2", "이어서", "테스트"]);
A("4 --resume <id> + 후속프롬프트", a.cmd === "resume" && a.session === "S2" && a.prompt === "이어서 테스트");

a = parseArgs(["do", "it", "-m", "claude-opus-4-8", "-b", "1.5", "--omc"]);
A("5 model/budget/omc + 프롬프트", a.model === "claude-opus-4-8" && a.budget === 1.5 && a.omc === true && a.prompt === "do it");

a = parseArgs(["--base", "https://x.app", "--bypass", "tok", "--save", "out.md", "task"]);
A("6 base/bypass/save", a.base === "https://x.app" && a.bypass === "tok" && a.save === "out.md" && a.prompt === "task");

a = parseArgs(["--help"]);
A("7 --help", a.cmd === "help");

a = parseArgs(["--json", "--list"]);
A("8 --json 플래그", a.cmd === "list" && a.json === true);

console.log(`\n총 ${pass + fail}건: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
