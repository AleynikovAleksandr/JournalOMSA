"""Заголовки безопасности для всех HTTP-ответов.

Content-Security-Policy:
* script-src 'self' — скрипты только с сервера приложения, сторонние запрещены
  (документ «WebRTC Control», 3.1);
* connect-src — fetch, XHR и WebSocket только к своему порту (документ
  «Страницы Flask и порты», раздел 6);
* style-src допускает атрибуты style: макеты страниц используют встроенные стили.
"""

from __future__ import annotations

from collections.abc import Iterable

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def websocket_origins(origins: Iterable[str]) -> list[str]:
    result = []
    for origin in origins:
        if origin.startswith("https://"):
            result.append("wss://" + origin.removeprefix("https://"))
        elif origin.startswith("http://"):
            result.append("ws://" + origin.removeprefix("http://"))
    return result


def build_csp(origins: Iterable[str]) -> str:
    connect = " ".join(["'self'", *websocket_origins(origins)])
    return "; ".join(
        [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            f"connect-src {connect}",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]
    )


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, csp: str) -> None:
        self.app = app
        self.headers = {
            "Content-Security-Policy": csp,
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "same-origin",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
            "Cross-Origin-Opener-Policy": "same-origin",
        }

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self.headers.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
