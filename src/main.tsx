import { render } from "preact";
import { App } from "./app";
import "./styles/app.css";

const root = document.getElementById("echo-root");
if (!root) {
  throw new Error("找不到 #echo-root 挂载点");
}
render(<App />, root);
