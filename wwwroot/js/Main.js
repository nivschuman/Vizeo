// Please see documentation at https://learn.microsoft.com/aspnet/core/client-side/bundling-and-minification
// for details on configuring this project to bundle and minify static web assets.

// Write your JavaScript code.

/*
const servers = [];
const pcConstraints = {
    'optional': [
        { 'DtlsSrtpKeyAgreement': true },
    ],
};
*/

//TBD setup stun and turn servers
const iceServers = [
    //google stun servers
    { 'urls': ['stun:74.125.142.127:19302', 'stun:172.217.192.127:19302'] }
];

const configuration = {
    'iceServers': iceServers
};

let localStream;
let remoteStream;
let peerConnection;

let hubConnection = new signalR.HubConnectionBuilder().withUrl("/Signals").build();
let toConnectionId;

hubConnection.on("SendOffer", doOffer);
hubConnection.on("SendAnswer", doAnswer);
hubConnection.on("HandleAnswer", addAnswer);
hubConnection.on("HandleCandidate", addCandidate);
hubConnection.on("PeerData", updatePeerUserData);
hubConnection.on("UpdateCounts", updateCounts);
hubConnection.on("PeerDisconnected", peerDisconnected);

async function setupDevice() {
    let stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

    let my_video = document.getElementById("my-video");
    my_video.srcObject = stream;

    localStream = stream;
}

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    //disable loading screen
    await disableLoadingScreen();

    //remote stream
    remoteStream = new MediaStream();
    let peer_video = document.getElementById("peer-video");
    peer_video.src = "";
    peer_video.srcObject = remoteStream;

    //local stream tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    //ontrack event
    peerConnection.ontrack = gotRemoteTrack;

    //onicecandidate event, send out ice candidates
    peerConnection.onicecandidate = doCandidate;

    //onconnectionstatechange event
    peerConnection.onconnectionstatechange = connectionStateChanged;
}

async function doOffer(tcId) {
    toConnectionId = tcId;
    await createPeerConnection();

    //doing offer
    let offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    hubConnection.invoke("PassOffer", toConnectionId, JSON.stringify(offer));
}

async function doAnswer(tcId, offer) {
    toConnectionId = tcId;
    await createPeerConnection();

    //set remote description
    offer = JSON.parse(offer);
    await peerConnection.setRemoteDescription(offer);

    //doing answer
    let answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    hubConnection.invoke("PassAnswer", toConnectionId, JSON.stringify(answer));
}

async function doCandidate(event) {
    if(event.candidate) {
        hubConnection.invoke("PassCandidate", toConnectionId, JSON.stringify(event.candidate));
    }
}

async function gotRemoteTrack(event) {
    console.log("got remote stream");
    console.log(event.streams);
    event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track); 
    });
}

async function addAnswer(tcId, answer) {
    toConnectionId = tcId
    answer = JSON.parse(answer);

    if(!peerConnection.currentRemoteDescription) {
        peerConnection.setRemoteDescription(answer);
    }
}

async function addCandidate(tcId, candidate) {
    toConnectionId = tcId;
    candidate = JSON.parse(candidate);

    if(peerConnection) {
        peerConnection.addIceCandidate(candidate)
    }
}

async function startHubConnection() {
    try {
        await hubConnection.start();
    } catch (err) {
        console.log(err);
        setTimeout(startHubConnection, 5000);
    }
}

async function disconnectPeer() {
    if(peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onremovetrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionsstatechange = null;
        peerConnection.onsignalingstatechange = null;

        toConnectionId = null;
    
        await peerConnection.close();
    }

    await enableLoadingScreen();
}

async function connectionStateChanged() {
    /*
    if (peerConnection.iceConnectionState == "disconnected") {
        await disconnectPeer();

        hubConnection.invoke("FindMate");
    }
    */
}

async function peerDisconnected() {
    await disconnectPeer();
    hubConnection.invoke("FindMate");
}

async function next() {
    await disconnectPeer();

    hubConnection.invoke("DisconnectFromPeer", true);
}

async function join() {
    userData = await getUserData();
    let userDataJson = JSON.stringify(userData);

    if(userData == null) {
        return;
    }

    hubConnection.invoke("Join", userDataJson);

    let peerColumn = document.getElementById("peer-column-content");
    peerColumn.hidden = false;

    let goButton = document.getElementById("goButton");
    goButton.onclick = go;

    let nextButton = document.getElementById("nextButton");
    nextButton.disabled = false;

    let stopButton = document.getElementById("stopButton");
    stopButton.disabled = false;

    await disableUserDataInput(); //also disables go button
    await enableLoadingScreen();

    hubConnection.invoke("FindMate");
}

async function go() {
    //disable go button
    let goButton = document.getElementById("goButton");
    goButton.disabled = true;

    //enable next button
    let nextButton = document.getElementById("nextButton");
    nextButton.disabled = false;

    //enable stop button
    let stopButton = document.getElementById("stopButton");
    stopButton.disabled = false;

    let peerColumn = document.getElementById("peer-column-content");
    peerColumn.hidden = false;

    hubConnection.invoke("FindMate");
}

async function stop() {
    if(peerConnection) {
        await disconnectPeer();
        hubConnection.invoke("DisconnectFromPeer", false); //also places user in stop status
    }
    else {
        hubConnection.invoke("StopSearching"); //places user in stop status
    }

    let peerColumn = document.getElementById("peer-column-content");
    peerColumn.hidden = true;

    //enable go button
    let goButton = document.getElementById("goButton");
    goButton.disabled = false;

    //disable next button
    let nextButton = document.getElementById("nextButton");
    nextButton.disabled = true;

    //disable stop button
    let stopButton = document.getElementById("stopButton");
    stopButton.disabled = true;
}

async function start() {
    if (localStream == undefined) {
        await setupDevice();
    }

    await startHubConnection();

    let goButton = document.getElementById("goButton");
    goButton.onclick = join;

    let nextButton = document.getElementById("nextButton");
    nextButton.onclick = next;

    let stopButton = document.getElementById("stopButton");
    stopButton.onclick = stop;

    await hubConnection.invoke("UpdateCountsClient");
}

async function getUserData() {
    let nameInput = document.getElementById("myNameInput");
    let name = nameInput.value;

    if(name == "") {
        alert("You need to enter a name!");
        return null;
    }

    let maleRadioButton = document.getElementById("maleRadioButton");
    let gender = maleRadioButton.checked ? "male" : "female";

    let countrySelection = document.getElementById("myCountrySelection");
    let country = countrySelection.value;

    let ageInput = document.getElementById("myAgeInput");
    let age = parseInt(ageInput.value);

    if(isNaN(age) || (age < 18 || age > 120)) {
        alert("Age must be bewteen 18 and 120!");
        return null;
    }

    let sameCountryCheckBox = document.getElementById("sameCountryCheckBox");
    let sameCountry = sameCountryCheckBox.checked ? "true" : "false";

    let malesCheckbox = document.getElementById("malesCheckBox");
    let males = malesCheckbox.checked ? "true" : "false";

    let femalesCheckbox = document.getElementById("femalesCheckBox");
    let females = femalesCheckbox.checked ? "true" : "false";

    if(males == "false" && females == "false") {
        alert("You must choose male or female or both!");
        return null;
    }

    let interestedIn = `${sameCountry};${males};${females}`;

    let userData = {
        Name: name,
        Country: country,
        Age: age,
        Gender: gender,
        InterestedIn: interestedIn
    }

    return userData;
}

async function disableUserDataInput() {
    let nameInput = document.getElementById("myNameInput");
    nameInput.disabled = true

    let maleRadioButton = document.getElementById("maleRadioButton");
    maleRadioButton.disabled = true;

    let countrySelection = document.getElementById("myCountrySelection");
    countrySelection.disabled = true;

    let ageInput = document.getElementById("myAgeInput");
    ageInput.disabled = true;

    let sameCountryCheckBox = document.getElementById("sameCountryCheckBox");
    sameCountryCheckBox.disabled = true;

    let malesCheckbox = document.getElementById("malesCheckBox");
    malesCheckbox.disabled = true;

    let femalesCheckbox = document.getElementById("femalesCheckBox");
    femalesCheckbox.disabled = true;

    let goButton = document.getElementById("goButton");
    goButton.disabled = true;
}

async function updatePeerUserData(peerModelJson)
{
    let peerModel = JSON.parse(peerModelJson);

    console.log(peerModel);

    let peerName = document.getElementById("peerName");
    peerName.textContent = peerModel.Name;

    let peerGender = document.getElementById("peerGender");
    peerGender.textContent = peerModel.Gender;

    let peerCountry = document.getElementById("peerCountry");
    peerCountry.textContent = peerModel.Country;

    let peerAge = document.getElementById("peerAge");
    peerAge.textContent = peerModel.Age.toString();

    let peerColumn = document.getElementById("peer-column-content");
    peerColumn.hidden = false;
}

async function enableLoadingScreen() {
    //add loading screen video
    let peer_video = document.getElementById("peer-video");
    peer_video.src = "/media/LoadingScreen.mp4";
    peer_video.srcObject = null;
    peer_video.loop = true;
    peer_video.muted = true;
    peer_video.play();

    //hide peer data
    let peer_info = document.getElementById("peer-info-container");
    peer_info.hidden = true;
}

async function disableLoadingScreen() {
    //remove loading screen video
    let peer_video = document.getElementById("peer-video");
    peer_video.src = "";
    peer_video.muted = false;
    peer_video.loop = false;

    //show peer data
    let peer_info = document.getElementById("peer-info-container");
    peer_info.hidden = false;
}

async function updateCounts(males, females, chatting) {
    let maleCount = document.getElementById("maleCount");
    let femaleCount = document.getElementById("femaleCount");
    let chattingCount = document.getElementById("chattingCount");

    maleCount.innerText = `Males: ${males}`;
    femaleCount.innerText = `Females: ${females}`;
    chattingCount.innerText = `Chatting: ${chatting}`;
}

start();

