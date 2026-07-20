FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy the solution and restore
COPY . ./

# launchSettings.json would force the Development environment,
# which keeps the app running instead of generating and exiting.
RUN rm -f KiranJoy.Web/Properties/launchSettings.json

# Generate the static site into KiranJoy.Web/output.
# Bind to a concrete loopback address; a wildcard bind (http://+:80 or 0.0.0.0)
# makes the BlazorStatic self-fetch fail with an unspecified-address error.
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://127.0.0.1:5000
RUN dotnet run --project KiranJoy.Web/KiranJoy.Web.csproj --configuration Release --no-launch-profile

# Build the Pagefind search index over the generated output.
FROM node:20-alpine AS search
WORKDIR /site
COPY --from=build /src/KiranJoy.Web/output ./
RUN npx -y pagefind --site .

# Serve the static output with nginx.
FROM nginx:alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=search /site /usr/share/nginx/html
EXPOSE 80
