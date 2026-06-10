const fs = require("fs");
const parser = require("@babel/parser");

const files = [
  "d:/worship-team-app/components/RosterScreen.js",
  "d:/worship-team-app/components/Dashboards.js",
  "d:/worship-team-app/components/SongDetailScreen.js",
  "d:/worship-team-app/components/TasksScreen.js"
];

let failed = false;

files.forEach(file => {
  console.log(`Checking syntax for ${file}...`);
  try {
    const code = fs.readFileSync(file, "utf8");
    parser.parse(code, {
      sourceType: "module",
      plugins: [
        "jsx",
        "flow",
        "classProperties",
        "objectRestSpread",
        "exportDefaultFrom",
        "exportNamespaceFrom",
        "nullishCoalescingOperator",
        "optionalChaining"
      ]
    });
    console.log(`✅ ${file} passed syntax check.\n`);
  } catch (err) {
    console.error(`❌ ${file} failed syntax check:`);
    console.error(err.stack || err.message);
    console.error("\n");
    failed = true;
  }
});

if (failed) {
  process.exit(1);
} else {
  console.log("All syntax checks passed successfully!");
}
