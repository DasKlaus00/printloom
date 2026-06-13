import ftplib
import ssl
import socket
import logging

logger = logging.getLogger(__name__)


class _ImplicitFTP_TLS(ftplib.FTP_TLS):
    """Implicit FTPS with SSL session reuse (required by Bambu Lab X1C, error 522)."""

    def connect(self, host='', port=0, timeout=-999, source_address=None):
        if port == 0:
            port = 990
        self.host = host
        self.port = port
        if timeout != -999:
            self.timeout = timeout
        self.source_address = source_address

        self.sock = socket.create_connection(
            (host, port),
            self.timeout if timeout == -999 else timeout,
            source_address
        )
        self.af = self.sock.family
        # Wrap with TLS immediately — implicit FTPS
        self.sock = self.context.wrap_socket(self.sock, server_hostname=host)
        self.file = self.sock.makefile('r', encoding=self.encoding)
        self.welcome = self.getresp()
        return self.welcome

    def ntransfercmd(self, cmd, rest=None):
        """Reuse the control connection's SSL session for the data connection.
        Bambu Lab requires session reuse (RFC 5077), otherwise returns 522."""
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(
                conn,
                server_hostname=self.host,
                session=self.sock.session,
            )
        return conn, size


def _make_tls_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class BambuFTP:
    """FTPS client for Bambu Lab X1C (implicit TLS, port 990)."""

    def __init__(self, ip: str, access_code: str, port: int = 990):
        self.ip = ip
        self.access_code = access_code
        self.port = port

    def upload_file(self, local_path: str, remote_filename: str) -> bool:
        """Upload a file to /cache/ on the printer. Returns True on success."""
        try:
            with _ImplicitFTP_TLS(context=_make_tls_context()) as ftp:
                ftp.connect(self.ip, self.port, timeout=30)
                ftp.login("bblp", self.access_code)
                ftp.prot_p()
                ftp.cwd("/cache")
                with open(local_path, "rb") as f:
                    ftp.storbinary(f"STOR {remote_filename}", f)

            logger.info(f"FTP upload OK: {remote_filename} → {self.ip}:/cache/")
            return True

        except Exception as e:
            logger.error(f"FTP upload failed: {e}")
            return False

    def test_connection(self) -> tuple[bool, str]:
        """Test FTP connectivity. Returns (success, message)."""
        try:
            with _ImplicitFTP_TLS(context=_make_tls_context()) as ftp:
                ftp.connect(self.ip, self.port, timeout=10)
                ftp.login("bblp", self.access_code)
            return True, "FTP connection successful"
        except Exception as e:
            return False, f"FTP connection failed: {e}"
