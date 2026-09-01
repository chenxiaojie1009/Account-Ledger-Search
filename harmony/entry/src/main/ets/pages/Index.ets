import { webview, WebNetErrorList } from '@kit.ArkWeb';
import { http } from '@kit.NetworkKit';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  schemeHandler: webview.WebSchemeHandler = new webview.WebSchemeHandler();

  aboutToAppear(): void {
    this.schemeHandler.onRequestStart((request: webview.WebSchemeHandlerRequest,
                                       resourceHandler: webview.WebResourceHandler) => {
      const url: string = request.getRequestUrl();
      // 只拦截 http/https（页面 JS 里的 API 请求）；本地资源不拦截
      if (!(url.startsWith('http://') || url.startsWith('https://'))) {
        return false;
      }
      this.forward(request, resourceHandler, url);
      return true;
    });
  }

  private forward(request: webview.WebSchemeHandlerRequest,
                  resourceHandler: webview.WebResourceHandler,
                  url: string): void {
    const httpRequest = http.createHttp();
    let method: string = 'GET';
    try {
      method = request.getRequestMethod();
    } catch (e) {
    }
    let headers: Record<string, string> = {};
    try {
      const hList: Array<webview.WebHeader> = request.getHeader();
      for (let i = 0; i < hList.length; i++) {
        headers[hList[i].headerKey] = hList[i].headerValue;
      }
    } catch (e) {
    }
    const options: http.HttpRequestOptions = {
      method: method as http.RequestMethod,
      header: headers,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: 10000,
      readTimeout: 30000,
    };
    const send = (): void => {
      httpRequest.request(url, options).then((resp: http.HttpResponse) => {
        try {
          const wr = new webview.WebSchemeHandlerResponse();
          wr.setNetErrorCode(WebNetErrorList.NET_OK);
          wr.setStatus(resp.responseCode);
          wr.setStatusText('OK');
          wr.setHeaderByName('Access-Control-Allow-Origin', '*', true);
          wr.setHeaderByName('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS', true);
          wr.setHeaderByName('Access-Control-Allow-Headers', 'Content-Type, Authorization', true);
          let ct: string = 'application/json';
          const rh: Object = resp.header;
          if (rh && (rh as Record<string, string>)['content-type']) {
            ct = (rh as Record<string, string>)['content-type'];
          }
          wr.setHeaderByName('Content-Type', ct, true);
          wr.setMimeType(ct);
          wr.setEncoding('utf-8');
          resourceHandler.didReceiveResponse(wr);
          const body = resp.result as ArrayBuffer;
          resourceHandler.didReceiveResponseBody(body);
          resourceHandler.didFinish();
        } catch (e) {
          resourceHandler.didFail(WebNetErrorList.ERR_CONNECTION_FAILED, true);
        }
      }).catch(() => {
        resourceHandler.didFail(WebNetErrorList.ERR_CONNECTION_FAILED, true);
      });
    };
    // POST / PUT body：兼容 chunked 流（getSize 可能为 0），循环读取直到 EOF 再拼接
    try {
      const stream = request.getHttpBodyStream();
      if (stream) {
        const chunks: Array<ArrayBuffer> = [];
        const chunkSize: number = 65536;
        let zeroCount: number = 0;
        const readLoop = (): void => {
          try {
            if (stream.isEof() || zeroCount >= 3) {
              if (chunks.length === 0) {
                send();
                return;
              }
              let total: number = 0;
              for (let i = 0; i < chunks.length; i++) {
                total += chunks[i].byteLength;
              }
              const merged = new Uint8Array(total);
              let off: number = 0;
              for (let i = 0; i < chunks.length; i++) {
                merged.set(new Uint8Array(chunks[i]), off);
                off += chunks[i].byteLength;
              }
              options.extraData = merged.buffer;
              send();
              return;
            }
            stream.read(chunkSize).then((buf: ArrayBuffer) => {
              if (buf && buf.byteLength > 0) {
                chunks.push(buf);
              } else {
                zeroCount++;
              }
              readLoop();
            }).catch(() => {
              readLoop();
            });
          } catch (e) {
            send();
          }
        };
        stream.initialize().then(() => {
          readLoop();
        }).catch(() => {
          send();
        });
        return;
      }
    } catch (e) {
    }
    send();
  }

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
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .zoomAccess(false)
        .onControllerAttached(() => {
          try {
            this.controller.setWebSchemeHandler('http', this.schemeHandler);
            this.controller.setWebSchemeHandler('https', this.schemeHandler);
          } catch (e) {
          }
        })
        .onPageBegin((event) => {
          console.info(`[taizhang] page begin: ${event.url}`);
        })
        .onPageEnd((event) => {
          console.info(`[taizhang] page end: ${event.url}`);
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F4F7FB')
  }
}
