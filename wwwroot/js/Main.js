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

let sendDataChannel;
let receiveDataChannel;

let bufferedIceCandidates = [];

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
    let stream = null;

    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    }
    catch(error) {
        if(error instanceof DOMException && error.name == "NotAllowedError") {
            alert("You must allow video and audio in order to use the website!");
        }
        else if(error instanceof DOMException && error.name == "NotFoundError") {
            alert("Video and audio to use for website were not found!");
        }
        else {
            alert(`Error with getting user media: ${error}`);
        }

        let goButton = document.getElementById("goButton");
        goButton.disabled = true;
    }

    let my_video = document.getElementById("my-video");
    my_video.srcObject = stream;

    localStream = stream;
}

async function createPeerConnection() {
    //clear out old buffered ice candidates
    bufferedIceCandidates = []

    //create new peer connection
    peerConnection = new RTCPeerConnection(configuration);

    //disable loading screen
    await disableLoadingScreen();

    //intialize remote stream
    remoteStream = new MediaStream();

    //local stream tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    //create sending data channel
    sendDataChannel = peerConnection.createDataChannel("ChatChannel");

    //send data channel open event
    sendDataChannel.onopen = () => { setMessageSendingState(false); };

    //ontrack event
    peerConnection.ontrack = gotRemoteTrack;

    //onicecandidate event, send out ice candidates
    peerConnection.onicecandidate = doCandidate;

    //onconnectionstatechange event
    peerConnection.onconnectionstatechange = connectionStateChanged;

    //ondatachannel event
    peerConnection.ondatachannel = gotDataChannel;
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

    //remote description was added, add buffered ice candidates
    bufferedIceCandidates.forEach(candidate => peerConnection.addIceCandidate(candidate));

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
        await peerConnection.setRemoteDescription(answer);

        //remote description was added, add buffered ice candidates
        bufferedIceCandidates.forEach(candidate => peerConnection.addIceCandidate(candidate));
    }
}

async function addCandidate(tcId, candidate) {
    toConnectionId = tcId;
    candidate = JSON.parse(candidate);

    //remote description was not yet set, send ice candidate to buffer
    //remote description must be set before trying to add ice candidates
    //otherwise we get error with addIceCandidate, remote description was null
    if(!peerConnection.currentRemoteDescription) {
        bufferedIceCandidates.push(candidate);
        return;
    }

    if(peerConnection) {
        peerConnection.addIceCandidate(candidate)
    }
}

async function gotDataChannel(event) {
    receiveDataChannel = event.channel;
    receiveDataChannel.onmessage = receivedMessage;
}

async function receivedMessage(event) {
    message = event.data

    await generateReceivedChatMessage(message);
}

async function sendMessage() {
    if(sendDataChannel == null) {
        return;
    }

    let messageToSendInput = document.getElementById("send-message-input");
    let messageToSend = messageToSendInput.value;

    await generateSentChatMessage(messageToSend);
    sendDataChannel.send(messageToSend);

    messageToSendInput.value = "";
}

async function closeDataChannels() {
    //close send data channel
    if(sendDataChannel != null) {
        sendDataChannel.close();
        sendDataChannel = null;
    }

    //close receive data channel
    if(receiveDataChannel != null) {
        receiveDataChannel.close();
        receiveDataChannel = null;
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

        await closeDataChannels();
        await clearChat();
        await setMessageSendingState(true);
    
        await peerConnection.close();
    }

    await enableLoadingScreen();
}

//TBD fix blank video
//TBD why is connection state never in "completed" state!?
async function connectionStateChanged() {
    console.log(peerConnection.iceConnectionState);

    //place remote stream onto peer video element only once connection state is "connected"
    if(peerConnection.iceConnectionState == "connected" || peerConnection.iceConnectionState == "completed") {
        let peer_video = document.getElementById("peer-video");
        peer_video.src = "";
        peer_video.srcObject = remoteStream;
    }

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

    let sendMessageButton = document.getElementById("sendMessageButton");
    sendMessageButton.onclick = sendMessage;

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

    //hide chat box
    let chat_box = document.getElementById("chat-box");
    chat_box.hidden = true;

    //disable next button
    let nextButton = document.getElementById("nextButton");
    nextButton.disabled = true;
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

    //show chat box
    let chat_box = document.getElementById("chat-box");
    chat_box.hidden = false;

    //enable next button
    let nextButton = document.getElementById("nextButton");
    nextButton.disabled = false;
}

async function updateCounts(males, females, chatting) {
    let maleCount = document.getElementById("maleCount");
    let femaleCount = document.getElementById("femaleCount");
    let chattingCount = document.getElementById("chattingCount");

    maleCount.innerText = `Males: ${males}`;
    femaleCount.innerText = `Females: ${females}`;
    chattingCount.innerText = `Chatting: ${chatting}`;
}

async function generateReceivedChatMessage(message) {
    const chatMessages = document.getElementById('chat-messages');

    // Create the main container div
    const mediaDiv = document.createElement('div');
    mediaDiv.className = 'media w-50 mb-3';

    // Create the image element
    const img = document.createElement('img');
    img.src = '../media/Profile.png'; // Ensure this path is correct for your project
    img.alt = 'peer';
    img.width = 50;
    img.className = 'rounded-circle';
    mediaDiv.appendChild(img);

    // Create the media-body div
    const mediaBodyDiv = document.createElement('div');
    mediaBodyDiv.className = 'media-body ml-3';
    mediaDiv.appendChild(mediaBodyDiv);

    // Create the message container div
    const messageContainerDiv = document.createElement('div');
    messageContainerDiv.className = 'bg-light rounded py-2 px-3 mb-2';
    mediaBodyDiv.appendChild(messageContainerDiv);

    // Create the message paragraph
    const messageParagraph = document.createElement('p');
    messageParagraph.className = 'text-small mb-0 text-muted';
    messageParagraph.innerText = message;
    messageContainerDiv.appendChild(messageParagraph);

    // Create the date paragraph
    const dateParagraph = document.createElement('p');
    dateParagraph.className = 'small text-muted';
    const now = new Date();
    const hours = now.getHours() > 12 ? now.getHours() - 12 : now.getHours();
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const timeString = `${hours}:${minutes} ${ampm}`;
    const dateString = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    dateParagraph.innerText = `${timeString} | ${dateString}`;
    mediaBodyDiv.appendChild(dateParagraph);

    // Append the generated message to the chat messages container
    chatMessages.appendChild(mediaDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to the bottom
}

async function generateSentChatMessage(message) {
    const chatMessages = document.getElementById('chat-messages');

    // Create the main container div
    const mediaDiv = document.createElement('div');
    mediaDiv.className = 'media w-50 ml-auto mb-3';

    // Create the image element
    const img = document.createElement('img');
    img.src = '../media/Me.png'; // Ensure this path is correct for your project
    img.alt = 'peer';
    img.width = 50;
    img.className = 'rounded-circle';
    mediaDiv.appendChild(img);

    // Create the media-body div
    const mediaBodyDiv = document.createElement('div');
    mediaBodyDiv.className = 'media-body';
    mediaDiv.appendChild(mediaBodyDiv);

    // Create the message container div
    const messageContainerDiv = document.createElement('div');
    messageContainerDiv.className = 'bg-primary rounded py-2 px-3 mb-2';
    mediaBodyDiv.appendChild(messageContainerDiv);

    // Create the message paragraph
    const messageParagraph = document.createElement('p');
    messageParagraph.className = 'text-small mb-0 text-white';
    messageParagraph.innerText = message;
    messageContainerDiv.appendChild(messageParagraph);

    // Create the date paragraph
    const dateParagraph = document.createElement('p');
    dateParagraph.className = 'small text-muted';
    const now = new Date();
    const hours = now.getHours() > 12 ? now.getHours() - 12 : now.getHours();
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const timeString = `${hours}:${minutes} ${ampm}`;
    const dateString = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    dateParagraph.innerText = `${timeString} | ${dateString}`;
    mediaBodyDiv.appendChild(dateParagraph);

    // Append the generated message to the chat messages container
    chatMessages.appendChild(mediaDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to the bottom
}

async function clearChat() {
    const chatMessages = document.getElementById('chat-messages');
    while (chatMessages.firstChild) {
        chatMessages.removeChild(chatMessages.lastChild);
    }
}

async function setMessageSendingState(disable) {
    let sendMessageInput = document.getElementById("send-message-input");
    sendMessageInput.disabled = disable;

    let sendMessageButton = document.getElementById("sendMessageButton");
    sendMessageButton.disabled = disable;
}

start();

