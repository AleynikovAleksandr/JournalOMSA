"""Токены доступа JWT (ТЗ, раздел 4).

JWT — короткоживущий токен, внутри которого «зашит» UUID пользователя (claim sub).
Время выдачи (claim iat) передаётся с точностью до миллисекунды: сервер сравнивает
его с password_changed_at и отклоняет токены, выданные до смены пароля.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

from app.schemas.responses import AuthenticationFailed
from core.clock import to_epoch_ms

TOKEN_TYPE_ACCESS = "access"
TOKEN_ISSUER = "omsa-ledger"


@dataclass(frozen=True, slots=True)
class AccessTokenClaims:
    subject: UUID
    audience: str
    issued_at_ms: int
    expires_at: datetime
    token_id: str


class JwtTokenCodec:
    """Выдача и проверка JWT (HS256).

    Срок действия проверяется по переданному времени (Clock), а не по системным
    часам внутри PyJWT: так правила срока действия одинаковы во всём приложении.
    """

    def __init__(self, *, secret: str, algorithm: str = "HS256", ttl: timedelta) -> None:
        if len(secret) < 32:
            raise ValueError("JWT_SECRET должен содержать не менее 32 символов")
        self._secret = secret
        self._algorithm = algorithm
        self._ttl = ttl

    @property
    def ttl(self) -> timedelta:
        return self._ttl

    def issue(self, subject: UUID, *, audience: str, now: datetime) -> tuple[str, datetime]:
        expires_at = now + self._ttl
        payload = {
            "iss": TOKEN_ISSUER,
            "sub": str(subject),
            "aud": audience,
            "typ": TOKEN_TYPE_ACCESS,
            "iat": to_epoch_ms(now) / 1000,
            "exp": int(expires_at.timestamp()),
            "jti": secrets.token_hex(16),
        }
        return jwt.encode(payload, self._secret, algorithm=self._algorithm), expires_at

    def decode(self, token: str, *, audience: str, now: datetime) -> AccessTokenClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[self._algorithm],
                audience=audience,
                issuer=TOKEN_ISSUER,
                options={
                    "require": ["sub", "aud", "iat", "exp", "iss"],
                    "verify_exp": False,
                    "verify_iat": False,
                    "verify_nbf": False,
                },
            )
            if payload.get("typ") != TOKEN_TYPE_ACCESS:
                raise AuthenticationFailed("Недействительный токен доступа")
            expires_at = datetime.fromtimestamp(int(payload["exp"]), tz=UTC)
            claims = AccessTokenClaims(
                subject=UUID(str(payload["sub"])),
                audience=audience,
                issued_at_ms=round(float(payload["iat"]) * 1000),
                expires_at=expires_at,
                token_id=str(payload.get("jti", "")),
            )
        except AuthenticationFailed:
            raise
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise AuthenticationFailed("Недействительный токен доступа") from exc
        if claims.expires_at <= now:
            raise AuthenticationFailed("Срок действия токена истёк")
        return claims
