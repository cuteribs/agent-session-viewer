// Service worker: open or focus the extension's full-page tab when the
// action icon is clicked. No popup is configured in the manifest.

const EXTENSION_PAGE = chrome.runtime.getURL('index.html')

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: EXTENSION_PAGE })
  if (tabs.length > 0 && tabs[0].id != null) {
    await chrome.tabs.update(tabs[0].id, { active: true })
    if (tabs[0].windowId != null) {
      await chrome.windows.update(tabs[0].windowId, { focused: true })
    }
  } else {
    await chrome.tabs.create({ url: EXTENSION_PAGE })
  }
})
