# Nginx 1.28.0 with the requested modules and OpenSSL source tree.
FROM nginx:1.28.0-bookworm AS build

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl libgd-dev libgeoip-dev libpcre3-dev \
      libperl-dev libxml2-dev libxslt1-dev perl zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src
RUN curl -fsSLO https://nginx.org/download/nginx-1.28.0.tar.gz \
    && curl -fsSLO https://www.openssl.org/source/old/3.5/openssl-3.5.0.tar.gz \
    && tar -xzf nginx-1.28.0.tar.gz \
    && tar -xzf openssl-3.5.0.tar.gz -C nginx-1.28.0

WORKDIR /usr/src/nginx-1.28.0
RUN ./configure \
      --prefix=/etc/nginx \
      --sbin-path=/usr/sbin/nginx \
      --modules-path=/usr/lib/nginx/modules \
      --conf-path=/etc/nginx/nginx.conf \
      --error-log-path=/var/log/nginx/error.log \
      --pid-path=/var/run/nginx.pid \
      --lock-path=/var/run/nginx.lock \
      --with-select_module \
      --with-poll_module \
      --with-threads \
      --with-file-aio \
      --with-http_ssl_module \
      --with-http_v2_module \
      --with-http_realip_module \
      --with-http_addition_module \
      --with-http_xslt_module=dynamic \
      --with-http_image_filter_module=dynamic \
      --with-http_geoip_module=dynamic \
      --with-http_sub_module \
      --with-http_dav_module \
      --with-http_flv_module \
      --with-http_mp4_module \
      --with-http_gunzip_module \
      --with-http_gzip_static_module \
      --with-http_auth_request_module \
      --with-http_random_index_module \
      --with-http_secure_link_module \
      --with-http_degradation_module \
      --with-http_slice_module \
      --with-http_stub_status_module \
      --with-http_perl_module=dynamic \
      --with-pcre \
      --with-pcre-jit \
      --with-openssl=./openssl-3.5.0 \
    && make -j"$(nproc)" \
    && make install

FROM nginx:1.28.0-bookworm

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgd3 libgeoip1 libperl5.36 libpcre3 libxml2 libxslt1.1 openssl \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/conf.d/default.conf

COPY --from=build /usr/sbin/nginx /usr/sbin/nginx
COPY --from=build /usr/lib/nginx/modules/ /usr/lib/nginx/modules/
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/nginx-wrapper.sh /usr/local/bin/nginx-wrapper.sh

RUN chmod 0755 /usr/local/bin/nginx-wrapper.sh \
    && mkdir -p /etc/nginx/templates /var/www/certbot /run/acme \
    && chown -R nginx:nginx /var/cache/nginx

EXPOSE 80 443 5600 5620
ENTRYPOINT ["/usr/local/bin/nginx-wrapper.sh"]
