import "./style.css";
import { init } from "./ui";

// Wait for fonts to load before initializing so canvas rendering is accurate
document.fonts.ready.then(() => {
  init();
});
