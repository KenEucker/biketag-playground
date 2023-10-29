import * as stst from "superstruct-ts-transformer";

// You define or use or import your own type
type User = {
    name: string;
    alive: boolean;
};

console.log({stst})

// You call this validate function passing your type as generic
// and json parse result as an argument
const obj = stst.validate<User>(JSON.parse('{ "name": "Me", "alive": true }'));
console.log({ obj })