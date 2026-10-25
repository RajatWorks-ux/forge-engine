/**
 * FORGE — Logger
 */

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';

export function log(message) {
  console.log(`${DIM}${message}${RESET}`);
}

export function error(message) {
  console.error(`${RED}${BOLD}[ERROR]${RESET} ${RED}${message}${RESET}`);
}

export function success(message) {
  console.log(`${GREEN}${BOLD}${message}${RESET}`);
}

export function stage(number, message) {
  console.log(`\n${CYAN}${BOLD}[Stage ${number}]${RESET} ${WHITE}${BOLD}${message}${RESET}`);
}

export function warn(message) {
  console.log(`${YELLOW}[WARN] ${message}${RESET}`);
}
