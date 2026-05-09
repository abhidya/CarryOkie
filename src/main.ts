import { hostPage, playerPage, receiverPage, debugPage } from "./app.ts";
const root = document.getElementById("app");
const page =
  root?.dataset.page ||
  location.pathname.split("/").filter(Boolean)[0] ||
  "home";
if (page === "host") hostPage(root);
if (page === "player") playerPage(root);
if (page === "receiver") receiverPage(root);
if (page === "debug") debugPage(root);
