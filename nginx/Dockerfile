FROM nginx:1.28.0-bookworm

USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/conf.d/default.conf

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/nginx-wrapper.sh /usr/local/bin/nginx-wrapper.sh

RUN chmod 0755 /usr/local/bin/nginx-wrapper.sh \
    && mkdir -p /etc/nginx/templates /run/acme \
    && chown -R 101:101 /etc/nginx /var/cache/nginx /var/log/nginx

EXPOSE 80 443 5600 5620
ENTRYPOINT ["/usr/local/bin/nginx-wrapper.sh"]
