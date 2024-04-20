﻿// Please see documentation at https://learn.microsoft.com/aspnet/core/client-side/bundling-and-minification
// for details on configuring this project to bundle and minify static web assets.

// Write your JavaScript code.
const servers = [];
const pcConstraints = {
    'optional': [
        { 'DtlsSrtpKeyAgreement': true },
    ],
};

let localStream;
let localPeerConnection;

let hubConnection = new signalR.HubConnectionBuilder().withUrl("/Signals").build();
let toConnectionId;

hubConnection.on("SendOffer", doOffer)
hubConnection.on("SendAnswer", doAnswer)
hubConnection.on("HandleAnswer", gotRemoteDescription)

async function setupDevice() {
    let stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

    let my_video = document.getElementById("my-video");
    my_video.srcObject = stream;

    localStream = stream;
}

async function doOffer(tcId) {
    toConnectionId = tcId;
    localPeerConnection = new RTCPeerConnection(servers, pcConstraints);
    localPeerConnection.onicecandidate = gotLocalIceCandidateOffer;
    localPeerConnection.onaddstream = gotRemoteStream;
    localPeerConnection.oniceconnectionstatechange = peerDisconnected;
    localPeerConnection.addStream(localStream);
    localPeerConnection.createOffer().then(gotLocalDescription);
}

async function doAnswer(tcId, offer) {
    offer = JSON.parse(offer);
    toConnectionId = tcId;
    localPeerConnection = new RTCPeerConnection(servers, pcConstraints);
    localPeerConnection.onicecandidate = gotLocalIceCandidateAnswer;
    localPeerConnection.onaddstream = gotRemoteStream;
    localPeerConnection.oniceconnectionstatechange = peerDisconnected;
    localPeerConnection.addStream(localStream);
    localPeerConnection.setRemoteDescription(offer);
    localPeerConnection.createAnswer().then(gotAnswerDescription);
}

async function gotLocalIceCandidateOffer(event) {
    if (!event.candidate) {
        const offer = localPeerConnection.localDescription;
        //send offer sdp to signaling server
        hubConnection.invoke("PassOffer", toConnectionId, JSON.stringify(offer));
    }
}

async function gotLocalIceCandidateAnswer(event) {
    if (!event.candidate) {
        const answer = localPeerConnection.localDescription;
        //send answer sdp to signaling server
        hubConnection.invoke("PassAnswer", toConnectionId, JSON.stringify(answer));
    }
}

async function gotRemoteStream(event) {
    let peer_video = document.getElementById("peer-video");
    peer_video.srcObject = event.stream;
}

async function gotLocalDescription(offer) {
    localPeerConnection.setLocalDescription(offer);
}

async function gotAnswerDescription(answer) {
    localPeerConnection.setLocalDescription(answer);
}

async function gotRemoteDescription(tcId, answer) {
    answer = JSON.parse(answer);
    toConnectionId = tcId;
    localPeerConnection.setRemoteDescription(answer);
}

async function startHubConnection() {
    try {
        await hubConnection.start();
    } catch (err) {
        console.log(err);
        setTimeout(startHubConnection, 5000);
    }

    //hubConnection.invoke("Join");
}

async function disconnectPeer() {
    localPeerConnection.ontrack = null;
    localPeerConnection.onremovetrack = null;
    localPeerConnection.onicecandidate = null;
    localPeerConnection.oniceconnectionsstatechange = null;
    localPeerConnection.onsignalingstatechange = null;

    await localPeerConnection.close();
}

async function peerDisconnected() {
    if (localPeerConnection.iceConnectionState == "disconnected") {
        await disconnectPeer();

        //hubConnection.invoke("Join");
    }
}

async function next() {
    await disconnectPeer();
    //hubConnection.invoke("Join");
}

async function join() {
    let nameInput = document.getElementById("myNameInput");
    let name = nameInput.value;

    let maleRadioButton = document.getElementById("maleRadioButton");
    let gender = maleRadioButton.checked ? "male" : "female";

    let countrySelection = document.getElementById("myCountrySelection");
    let country = countrySelection.value;

    let ageInput = document.getElementById("myAgeInput");
    let age = parseInt(ageInput.value);

    let sameCountryCheckBox = document.getElementById("sameCountryCheckBox");
    let sameCountry = sameCountryCheckBox.checked ? "true" : "false";

    let malesCheckbox = document.getElementById("malesCheckBox");
    let males = malesCheckbox.checked ? "true" : "false";

    let femalesCheckbox = document.getElementById("femalesCheckBox");
    let females = femalesCheckbox.checked ? "true" : "false";

    let interestedIn = `${sameCountry};${males};${females}`;

    let userData = {
        Name: name,
        Country: country,
        Age: age,
        Gender: gender,
        InterestedIn: interestedIn
    }

    let userDataJson = JSON.stringify(userData);

    hubConnection.invoke("Join", userDataJson);
}

async function start() {
    if (localStream == undefined) {
        await setupDevice();
    }

    await startHubConnection();

    let goButton = document.getElementById("goButton");
    goButton.onclick = join;
}

start();

