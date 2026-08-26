import { webview } from '@kit.ArkWeb';

const PAGE_BG: string = '#F4F7FB';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

  onBackPress(): boolean {
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (e) {
    }
    return false;
  }

  build() {
    Stack() {
      Web({ src: $rawfile('www/index.html'), controller: this.controller })
        .width('100%')
        .height('100%')
        .backgroundColor(PAGE_BG)
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedContent(MixedMode.All)
        .zoomAccess(false)
        .onControllerAttached(() => {
          console.info('[taizhang] web controller attached');
        })
        .onPageBegin((event) => {
          console.info(`[taizhang] page begin: ${event.request.getRequestUrl()}`);
        })
        .onPageEnd((event) => {
          console.info(`[taizhang] page end: ${event.request.getRequestUrl()}`);
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PAGE_BG)
  }
}
