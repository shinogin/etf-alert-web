// プッシュ通知の受信とタップ時の遷移を処理する。
self.addEventListener("push", (event) => {
    let data = { title: "ETF通知", body: "" };
    try {
          data = event.data.json();
    } catch (e) {
          data.body = event.data ? event.data.text() : "";
    }
    event.waitUntil(
          self.registration.showNotification(data.title || "ETF通知", {
                  body: data.body || "",
                  icon: "icons/icon-192.png",
                  data: { code: data.code },
          })
        );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const code = event.notification.data?.code;
    const url = code ? `./index.html?code=${code}` : "./index.html";
    event.waitUntil(clients.openWindow(url));
});

// メインスレッドからのメッセージ受信(テスト通知送信用)
self.addEventListener("message", (event) => {
    if (event.data.type === "SEND_TEST_NOTIFICATION") {
          event.waitUntil(
                  self.registration.showNotification(event.data.title || "テスト通知", {
                            body: event.data.body || "",
                            icon: "icons/icon-192.png",
                            tag: "test-notification",
                            requireInteraction: true
                  })
                );
    }
});
