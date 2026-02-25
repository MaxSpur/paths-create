import "leaflet/dist/leaflet.css";
import "./styles.css";
import { createApp } from "./ui/app";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root element.");
}

createApp(root);
