// No file system on the phone. Reads fail (the engine then uses its demo data)
// and writes are ignored, so offline state resets when the app restarts.
const fs = {
  readFileSync() {
    throw new Error("No file system offline");
  },
  writeFileSync() {},
  mkdirSync() {},
};
export default fs;
