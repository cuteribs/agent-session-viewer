// Background service worker — opens or focuses the viewer tab when the extension icon is clicked
chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL('index.html')

  chrome.tabs.query({ url }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id !== undefined) {
      // Focus the existing tab instead of opening a duplicate
      chrome.tabs.update(tabs[0].id, { active: true })
      if (tabs[0].windowId !== undefined) {
        chrome.windows.update(tabs[0].windowId, { focused: true })
      }
    } else {
      chrome.tabs.create({ url })
    }
  })
})
