import { boot } from "../lib/boot";
import { closeDb } from "../lib/db";

boot({ withServices: false })
  .then(async () => {
    console.log("migrations applied");
    await closeDb();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
