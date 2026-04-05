import "./style.css";
import { init } from "./ui";

// Wait for fonts to load before initializing so canvas rendering is accurate
document.fonts.ready.then(() => {
  init();
});

// Ko-fi widget
const kofiContainer = document.getElementById("footer-kofi")!;

type KofiWidget = { init: (text: string, color: string, id: string) => void; getHTML: () => string };

const renderKofi = () => {
  const widget = (window as Window & { kofiwidget2?: KofiWidget }).kofiwidget2;
  if (!widget) return;
  widget.init("Support me on Ko-fi", "#c0392b", "D1D71SUY9Q");
  kofiContainer.innerHTML = widget.getHTML();
};

const existingScript = document.querySelector<HTMLScriptElement>('script[data-kofi-widget="true"]');
if (existingScript) {
  if ((window as Window & { kofiwidget2?: unknown }).kofiwidget2) {
    renderKofi();
  } else {
    existingScript.addEventListener("load", renderKofi, { once: true });
  }
} else {
  const script = document.createElement("script");
  script.src = "https://storage.ko-fi.com/cdn/widget/Widget_2.js";
  script.async = true;
  script.dataset.kofiWidget = "true";
  script.addEventListener("load", renderKofi);
  document.body.appendChild(script);
}
