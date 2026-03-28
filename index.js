const app = require("./src/app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ntfy-coolify-webhook-bridge listening on port ${PORT}`);
});
