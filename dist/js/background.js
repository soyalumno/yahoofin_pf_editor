chrome.runtime.onInstalled.addListener(() => {
  console.log("Yahoo Finance Portfolio Editor Extension installed.");
});

chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: {tabId: tab.id},
    function: () => {
      chrome.storage.local.get('enabled', (data) => {
        console.log(data)
        const curr = data.enabled ?? true;
        const next = !curr;
        Array.from(document.querySelectorAll('.yahoo-pf-editor'))
          .forEach((tag) => tag.style.display = next ? 'flex' : 'none');
        chrome.storage.local.set({enabled: next});
      });
    }
  });
});

