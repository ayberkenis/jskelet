export default function register(app) {
  app.get("/", (req, res) => {
    res.type("html").send("<!doctype html><title>ok</title><p>ok</p>");
  });
}
