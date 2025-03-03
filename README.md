
# Cloud Browser (server)

Server side api for a cloud browser which uses Kasm VNC to use chromium in the cloud.

## Running
you can either run the docker container:
```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock epic-person-on/cloud-browser:latest 
```
> [!NOTE]  
> The Docker image uses Docker in Docker which may does pose some security issues.

> [!NOTE]
> The server you are running cloud browser on should be dedicated to cloud browser.

or you can start it from source with:
```bash
npm install

node app.mjs
```


## API Reference

#### Create Container

```http
  POST /create-container
```
##### Example response

```json
{
    "message": "Container created successfully",
    "uuid": "1c7170ddcf6a843936cdcefc52c369cee7024835f65d72a1846f15c0c0bf852a",
    "ports": {
        "port1": 25025,
        "port2": 10773
    }
}
```

Port 1 is the http port. 
Port 2 is the https port.

#### Delete container

```http
  DELETE /delete-container/${id}
```

| Parameter | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `id`      | `string` | **Required**. Id of container to delete |

##### Example response

```json
{
    "message": "Container e1661b1962a255442f6a2ca0828a49718a3eef363368122cdb5bbdf35d0ac75a deleted successfully"
}
```

#### Authorization

All parts of the api need a bearer authorization token as specified in the app.mjs
Example curl request:
curl -XPOST -H 'Authorization: Bearer your-token' 'https://server.com/create-container'
