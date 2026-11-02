chrome.devtools.panels.create("pts-cc-inspector", "", "panel.html", (panel) => {
  panel.onShown.addListener((win) =>
    win.dispatchEvent(
      new CustomEvent("pts-panel-visibility", { detail: true }),
    ),
  );
  panel.onHidden.addListener(() =>
    chrome.runtime
      .sendMessage({
        type: "panel-hidden",
        tabId: chrome.devtools.inspectedWindow.tabId,
      })
      .catch(() => {}),
  );
});
