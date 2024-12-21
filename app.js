let scene, camera, renderer, controls;
let model = null;
let detectedCircles = [];
let raycaster, mouse;
let hoverMarker = null;
let hoveredPoint = null;
let topFaceIndex = null;
let selectionMode = false;
let highlightedFace = null;
let topFaceNormal = null;
let topFaceHighlight = null;

init();
animate();

function init() {
    // Setup Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    // Setup Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth * 0.8 / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    // Setup Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth * 0.8, window.innerHeight);
    document.getElementById('viewer').appendChild(renderer.domElement);

    // Add Lights
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Setup Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Setup Raycaster
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Event Listeners
    renderer.domElement.addEventListener('click', onModelClick);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onWindowResize);
    document.getElementById('fileInput').addEventListener('change', loadSTL);
    document.getElementById('resetView').addEventListener('click', resetView);
    document.getElementById('exportData').addEventListener('click', exportCircleData);
    document.getElementById('clearAll').addEventListener('click', clearAllCircles);
    document.getElementById('selectFace').addEventListener('click', toggleFaceSelection);
}
function toggleFaceSelection() {
    selectionMode = !selectionMode;
    const button = document.getElementById('selectFace');
    if (selectionMode) {
        button.style.background = '#ff4444';
        button.textContent = 'Cancel Face Selection';
        updateStatus('Click any face to set it as top face');
    } else {
        button.style.background = '#2196f3';
        button.textContent = 'Select Top Face';
        updateStatus('Face selection cancelled');
        if (highlightedFace) {
            scene.remove(highlightedFace);
            highlightedFace = null;
        }
    }
}
function loadSTL(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const loader = new THREE.STLLoader();
        const geometry = loader.parse(e.target.result);

        if (model) scene.remove(model);

        const material = new THREE.MeshPhongMaterial({
            color: 0x909090,
            specular: 0x333333,
            shininess: 30,
            side: THREE.DoubleSide
        });

        model = new THREE.Mesh(geometry, material);
        model.geometry.computeVertexNormals();
        scene.add(model);

        resetView();
        updateStatus('Model loaded successfully');
    };
    reader.readAsArrayBuffer(file);
}

function getViewRay(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    return raycaster;
}

function onMouseMove(event) {
    if (!model) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(model);

    if (intersects.length > 0) {
        const intersect = intersects[0];

        if (selectionMode) {
            // Get the face normal in world space
            const faceNormal = intersect.face.normal.clone();
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(model.matrixWorld);
            faceNormal.applyMatrix3(normalMatrix).normalize();

            // Create or update highlight mesh
            if (!highlightedFace) {
                const planeGeom = new THREE.PlaneGeometry(1, 1);
                const planeMat = new THREE.MeshBasicMaterial({
                    color: 0x4CAF50,
                    transparent: true,
                    opacity: 0.2,
                    side: THREE.DoubleSide,
                    depthTest: false
                });
                highlightedFace = new THREE.Mesh(planeGeom, planeMat);
                scene.add(highlightedFace);
            }

            // Create basis vectors for the face
            const basis = createLocalBasis(faceNormal);

            // Find points near the plane
            const positions = model.geometry.attributes.position;
            const worldMatrix = model.matrixWorld;
            const vertex = new THREE.Vector3();
            const points = [];

            for (let i = 0; i < positions.count; i++) {
                vertex.fromBufferAttribute(positions, i);
                vertex.applyMatrix4(worldMatrix);

                const toPoint = vertex.clone().sub(intersect.point);
                const dist = Math.abs(toPoint.dot(faceNormal));

                if (dist < 0.1) { // Points within 0.1mm of the plane
                    points.push(vertex);
                }
            }

            if (points.length > 0) {
                // Calculate bounds in face plane
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;

                points.forEach(p => {
                    const localPoint = p.clone().sub(intersect.point);
                    const x = localPoint.dot(basis.tangent);
                    const y = localPoint.dot(basis.bitangent);

                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                });

                // Set highlight position and scale
                highlightedFace.position.copy(intersect.point);
                highlightedFace.scale.set(
                    maxX - minX + 1,
                    maxY - minY + 1,
                    1
                );

                // Orient highlight to match face
                const rotMatrix = new THREE.Matrix4();
                rotMatrix.makeBasis(
                    basis.tangent,
                    basis.bitangent,
                    basis.normal
                );
                highlightedFace.setRotationFromMatrix(rotMatrix);
            }
        } else {
            if (highlightedFace) {
                scene.remove(highlightedFace);
                highlightedFace = null;
            }

            hoveredPoint = intersect.point;
            const vector = hoveredPoint.clone();
            vector.project(camera);

            const hoverGuide = document.getElementById('hoverGuide');
            const x = (vector.x + 1) / 2 * rect.width + rect.left;
            const y = -(vector.y - 1) / 2 * rect.height + rect.top;

            const size = 10 / intersect.distance * 20;

            hoverGuide.style.display = 'block';
            hoverGuide.style.left = (x - size / 2) + 'px';
            hoverGuide.style.top = (y - size / 2) + 'px';
            hoverGuide.style.width = size + 'px';
            hoverGuide.style.height = size + 'px';
        }
    } else {
        if (highlightedFace) {
            scene.remove(highlightedFace);
            highlightedFace = null;
        }
        hoveredPoint = null;
        document.getElementById('hoverGuide').style.display = 'none';
    }
}
function calculateFaceBounds(point, normal, geometry) {
    // Project points onto the face plane and find bounds
    const positions = geometry.attributes.position;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    const basis = createLocalBasis(normal);
    const vertex = new THREE.Vector3();
    const projected = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        vertex.applyMatrix4(model.matrixWorld);

        // Project point onto plane
        const toPoint = vertex.clone().sub(point);
        const dist = toPoint.dot(normal);
        if (Math.abs(dist) > 0.1) continue; // Only consider points near the plane

        projected.copy(vertex).sub(normal.multiplyScalar(dist));

        // Convert to local 2D coordinates
        const x = projected.clone().sub(point).dot(basis.tangent);
        const y = projected.clone().sub(point).dot(basis.bitangent);

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }

    return {
        width: maxX - minX + 0.5,  // Add small padding
        height: maxY - minY + 0.5
    };
}

function calculateRotation(normal) {
    // Create basis vectors
    const basis = createLocalBasis(normal);

    // Convert to Euler angles
    const rotationMatrix = new THREE.Matrix4();
    rotationMatrix.makeBasis(basis.tangent, basis.bitangent, basis.normal);

    const euler = new THREE.Euler();
    euler.setFromRotationMatrix(rotationMatrix, 'XYZ');

    // Convert to degrees and round
    return {
        x: Math.round(euler.x * (180 / Math.PI) * 100) / 100,
        y: Math.round(euler.y * (180 / Math.PI) * 100) / 100,
        z: Math.round(euler.z * (180 / Math.PI) * 100) / 100
    };
}
function calculateDistances(circles) {
    const distances = [];
    for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
            const dist = circles[i].center.distanceTo(circles[j].center);
            distances.push({
                from: i + 1,
                to: j + 1,
                distance: Math.round(dist * 100) / 100
            });
        }
    }
    return distances;
}

function detectCircle(point, normal, geometry) {
    // Create local coordinate system
    const basis = createLocalBasis(normal);
    const searchRadius = 5;  // Slightly larger search radius

    // Pre-allocate vectors for reuse
    const vertex = new THREE.Vector3();
    const vertNormal = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    const projectedPoint = new THREE.Vector3();

    // Build point cloud
    const candidatePoints = [];
    const positions = geometry.attributes.position;
    const vertexNormals = geometry.attributes.normal;

    // Collect points near the click
    for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        vertex.applyMatrix4(model.matrixWorld);

        const distance = vertex.distanceTo(point);
        if (distance > searchRadius) continue;

        vertNormal.fromBufferAttribute(vertexNormals, i);
        vertNormal.applyMatrix3(model.normalMatrix);
        vertNormal.normalize();

        toPoint.copy(vertex).sub(point);
        const distanceToPlane = toPoint.dot(normal);

        // More forgiving plane distance
        if (Math.abs(distanceToPlane) > 0.8) continue;

        // Project point to plane
        projectedPoint.copy(vertex).sub(normal.clone().multiplyScalar(distanceToPlane));

        // Convert to 2D coordinates on plane using the basis vectors
        const localX = projectedPoint.clone().sub(point).dot(basis.tangent);
        const localY = projectedPoint.clone().sub(point).dot(basis.bitangent);

        candidatePoints.push({
            x: localX,
            y: localY,
            original: vertex.clone(),
            normal: vertNormal.clone()
        });
    }

    console.log(`Found ${candidatePoints.length} candidate points`);
    if (candidatePoints.length < 15) return null;  // Require fewer points

    // Try to find circular patterns using RANSAC-like approach
    let bestCircle = null;
    let bestScore = 0;
    const maxAttempts = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Pick three random points to define a circle
        const indices = [];
        while (indices.length < 3) {
            const idx = Math.floor(Math.random() * candidatePoints.length);
            if (!indices.includes(idx)) indices.push(idx);
        }

        const p1 = candidatePoints[indices[0]];
        const p2 = candidatePoints[indices[1]];
        const p3 = candidatePoints[indices[2]];

        // Calculate circle through these points
        const temp = p2.x * p2.x + p2.y * p2.y;
        const bc = (p1.x * p1.x + p1.y * p1.y - temp) / 2.0;
        const cd = (temp - p3.x * p3.x - p3.y * p3.y) / 2.0;
        const det = (p1.x - p2.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p2.y);

        if (Math.abs(det) < 1e-6) continue;

        const cx = (bc * (p2.y - p3.y) - cd * (p1.y - p2.y)) / det;
        const cy = ((p1.x - p2.x) * cd - (p2.x - p3.x) * bc) / det;
        const radius = Math.sqrt((p1.x - cx) * (p1.x - cx) + (p1.y - cy) * (p1.y - cy));

        // Wider radius range
        if (radius < 1.2 || radius > 5.5) continue;

        let pointsOnCircle = 0;
        const angles = new Set();
        const tolerance = 0.3;  // More forgiving tolerance

        for (const p of candidatePoints) {
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (Math.abs(dist - radius) < tolerance) {
                const angle = Math.floor((Math.atan2(dy, dx) + Math.PI) * 16 / (2 * Math.PI));
                angles.add(angle);
                pointsOnCircle++;
            }
        }

        const score = (pointsOnCircle / candidatePoints.length) * (angles.size / 16);

        if (score > bestScore && angles.size >= 8) {  // Require fewer angles
            bestScore = score;
            bestCircle = { x: cx, y: cy, radius: radius };
        }
    }

    if (!bestCircle || bestScore < 0.25) {
        console.log(`No good circle found. Best score: ${bestScore}`);
        return null;
    }

    console.log(`Found circle with radius ${bestCircle.radius}mm and score ${bestScore}`);

    // Convert back to 3D using basis vectors
    const center3D = point.clone()
        .add(basis.tangent.multiplyScalar(bestCircle.x))
        .add(basis.bitangent.multiplyScalar(bestCircle.y));

    return {
        center: center3D,
        radius: bestCircle.radius,
        normal: normal.clone(),
        quality: bestScore
    };
}
function createLocalBasis(normal) {
    // Create a proper orthonormal basis aligned with the face
    const tangent = new THREE.Vector3();
    const bitangent = new THREE.Vector3();

    // Find the smallest component to use for tangent calculation
    if (Math.abs(normal.x) < Math.abs(normal.y) && Math.abs(normal.x) < Math.abs(normal.z)) {
        tangent.set(0, -normal.z, normal.y);
    } else if (Math.abs(normal.y) < Math.abs(normal.z)) {
        tangent.set(-normal.z, 0, normal.x);
    } else {
        tangent.set(-normal.y, normal.x, 0);
    }

    tangent.normalize();
    bitangent.crossVectors(normal, tangent).normalize();
    tangent.crossVectors(bitangent, normal).normalize();

    return {
        tangent: tangent,
        bitangent: bitangent,
        normal: normal
    };
}

function isNearExistingCircle(newCircle) {
    const minDistance = 2; // 2mm minimum distance between circle centers
    return detectedCircles.some(circle => 
        circle.center.distanceTo(newCircle.center) < minDistance
    );
}

function onModelClick(event) {
    if (!model) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(model);

    if (intersects.length > 0) {
        const point = intersects[0].point;

        // Get the face normal in world space
        const faceNormal = intersects[0].face.normal.clone();
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(model.matrixWorld);
        faceNormal.applyMatrix3(normalMatrix).normalize();

        if (selectionMode) {
            // Handle face selection
            if (highlightedFace) {
                scene.remove(highlightedFace);
                highlightedFace = null;
            }

            setTopFace(faceNormal, point);
            const rotation = calculateRotation(faceNormal);
            updateStatus(`Top face set - Normal: (${rotation.x}°, ${rotation.y}°, ${rotation.z}°)`);

            // Exit selection mode
            selectionMode = false;
            const button = document.getElementById('selectFace');
            button.style.background = '#2196f3';
            button.textContent = 'Select Top Face';
            return;
        }

        // Normal circle detection logic
        const circle = detectCircle(point, faceNormal, model.geometry);

        if (circle && !isNearExistingCircle(circle)) {
            const markerGeometry = new THREE.TorusGeometry(
                circle.radius,
                0.1,
                32,
                32
            );
            const markerMaterial = new THREE.MeshBasicMaterial({
                color: 0x4CAF50,
                opacity: 0.8,
                transparent: true
            });
            const marker = new THREE.Mesh(markerGeometry, markerMaterial);
            marker.position.copy(circle.center);

            // Create local basis for orientation
            const basis = createLocalBasis(circle.normal);

            // Create rotation matrix from basis vectors
            const rotMatrix = new THREE.Matrix4();
            rotMatrix.makeBasis(
                basis.tangent,
                basis.bitangent,
                basis.normal
            );

            // Apply rotation to marker
            marker.setRotationFromMatrix(rotMatrix);

            scene.add(marker);
            circle.marker = marker;

            detectedCircles.push(circle);
            updateCircleList();
            updateStatus('Circle detected');
        } else if (circle) {
            updateStatus('Circle already detected in this location');
        } else {
            updateStatus('No circle detected at this location');
        }
    }
}
function clearAllCircles() {
    detectedCircles.forEach(circle => {
        if (circle.marker) {
            scene.remove(circle.marker);
        }
    });
    detectedCircles = [];
    updateCircleList();
    updateStatus('All circles cleared');
}
function groupHolesByFace(holes) {
    const groups = [];
    const normalTolerance = 0.05; // Tolerance for normal alignment
    const planeDistanceTolerance = 0.5; // mm tolerance for being on same plane

    holes.forEach((hole, index) => {
        let foundGroup = false;

        for (const group of groups) {
            const firstHole = group[0];

            // Check if normals are aligned
            if (firstHole.normal.dot(hole.normal) > 0.99) { // More strict normal check
                // Calculate distance to the plane of the first hole
                const toPoint = hole.center.clone().sub(firstHole.center);
                const distanceToPlane = toPoint.dot(firstHole.normal);

                // Check if hole lies in the same plane
                if (Math.abs(distanceToPlane) < planeDistanceTolerance) {
                    // Calculate if hole is connected to any hole in the group
                    let isConnected = false;
                    for (const existingHole of group) {
                        // Project both holes onto the plane
                        const v = hole.center.clone().sub(existingHole.center);
                        const projectedDist = v.length();
                        const heightDiff = Math.abs(v.dot(firstHole.normal));

                        // Consider holes connected if they're close enough and at same "height"
                        if (projectedDist < 50 && heightDiff < planeDistanceTolerance) { // 50mm max separation
                            isConnected = true;
                            break;
                        }
                    }

                    if (isConnected) {
                        group.push(hole);
                        foundGroup = true;
                        break;
                    }
                }
            }
        }

        if (!foundGroup) {
            groups.push([hole]);
        }
    });

    // Sort holes within each group by position
    groups.forEach(group => {
        const normal = group[0].normal;

        // Create basis for sorting
        const basis = createLocalBasis(normal);

        group.sort((a, b) => {
            // Project holes onto the face plane and sort by x, then y
            const aLocal = {
                x: a.center.clone().sub(group[0].center).dot(basis.tangent),
                y: a.center.clone().sub(group[0].center).dot(basis.bitangent)
            };
            const bLocal = {
                x: b.center.clone().sub(group[0].center).dot(basis.tangent),
                y: b.center.clone().sub(group[0].center).dot(basis.bitangent)
            };

            // Sort by x first, then y if x is equal
            if (Math.abs(aLocal.x - bLocal.x) > 0.1) {
                return aLocal.x - bLocal.x;
            }
            return aLocal.y - bLocal.y;
        });
    });

    return groups;
}
function calculateAlignedDistances(holes) {
    const distances = [];
    const alignmentTolerance = 0.1; // mm tolerance for considering holes aligned

    // For each pair of holes on the same face
    for (let i = 0; i < holes.length; i++) {
        for (let j = i + 1; j < holes.length; j++) {
            const hole1 = holes[i];
            const hole2 = holes[j];

            // Calculate vector between hole centers
            const dx = hole2.center.x - hole1.center.x;
            const dy = hole2.center.y - hole1.center.y;
            const dz = hole2.center.z - hole1.center.z;

            // Find the dominant axis
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            const absDz = Math.abs(dz);
            const maxDist = Math.max(absDx, absDy, absDz);

            // Check if holes are aligned on an axis
            if (maxDist === absDx && absDy < alignmentTolerance && absDz < alignmentTolerance) {
                distances.push({
                    from: holes[i],
                    to: holes[j],
                    distance: Math.abs(dx),
                    axis: 'X'
                });
            } else if (maxDist === absDy && absDx < alignmentTolerance && absDz < alignmentTolerance) {
                distances.push({
                    from: holes[i],
                    to: holes[j],
                    distance: Math.abs(dy),
                    axis: 'Y'
                });
            } else if (maxDist === absDz && absDx < alignmentTolerance && absDy < alignmentTolerance) {
                distances.push({
                    from: holes[i],
                    to: holes[j],
                    distance: Math.abs(dz),
                    axis: 'Z'
                });
            }
        }
    }

    return distances;
}

function updateCircleList() {
    const container = document.getElementById('detectedCircles');
    container.innerHTML = '<h3>Detected Circles:</h3>';

    const faceGroups = groupHolesByFace(detectedCircles);

    faceGroups.forEach((group, faceIndex) => {
        const faceDiv = document.createElement('div');
        faceDiv.className = 'face-group';

        const faceHeader = document.createElement('div');
        faceHeader.className = 'face-controls';

        const faceTitle = document.createElement('h4');
        faceTitle.style.margin = '0';
        faceTitle.textContent = `Face ${faceIndex + 1}`;
        if (faceIndex === topFaceIndex) {
            faceTitle.textContent += ' (Top Face)';
            faceTitle.style.color = '#ffd700';
        }

        faceHeader.appendChild(faceTitle);
        faceDiv.appendChild(faceHeader);

        group.forEach((circle, index) => {
            const div = document.createElement('div');
            div.className = 'detected-circle';

            const rotation = calculateRotation(circle.normal);
            const info = document.createElement('div');
            info.innerHTML = `
                Hole ${index + 1}<br>
                Diameter: ${(circle.radius * 2).toFixed(2)}mm<br>
                Position: (${circle.center.x.toFixed(2)}, 
                          ${circle.center.y.toFixed(2)}, 
                          ${circle.center.z.toFixed(2)})<br>
                Rotation: (${rotation.x}°, ${rotation.y}°, ${rotation.z}°)
            `;

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.onclick = () => deleteCircle(detectedCircles.indexOf(circle));

            div.appendChild(info);
            div.appendChild(deleteBtn);
            faceDiv.appendChild(div);
        });

        // Add aligned distances for this face
        const distances = calculateAlignedDistances(group);
        if (distances.length > 0) {
            const distanceDiv = document.createElement('div');
            distanceDiv.className = 'distance-info';
            distanceDiv.innerHTML = '<b>Aligned Distances:</b><br>';
            distances.forEach(d => {
                const fromIndex = group.indexOf(d.from);
                const toIndex = group.indexOf(d.to);
                distanceDiv.innerHTML += `
                    Holes ${fromIndex + 1} to ${toIndex + 1}: 
                    ${d.distance.toFixed(2)}mm (${d.axis}-axis)<br>
                `;
            });
            faceDiv.appendChild(distanceDiv);
        }

        container.appendChild(faceDiv);
    });
}
function setTopFace(normal, point) {
    topFaceNormal = normal.clone();

    // Remove old highlight if it exists
    if (topFaceHighlight) {
        scene.remove(topFaceHighlight);
    }

    // Create new highlight plane
    const planeGeom = new THREE.PlaneGeometry(1, 1);
    const planeMat = new THREE.MeshBasicMaterial({
        color: 0x4CAF50,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthTest: true
    });
    topFaceHighlight = new THREE.Mesh(planeGeom, planeMat);

    // Calculate face bounds
    const basis = createLocalBasis(normal);
    const positions = model.geometry.attributes.position;
    const worldMatrix = model.matrixWorld;
    const vertex = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        vertex.applyMatrix4(worldMatrix);

        const toPoint = vertex.clone().sub(point);
        const dist = Math.abs(toPoint.dot(normal));

        if (dist < 0.1) {
            const localPoint = vertex.clone().sub(point);
            const x = localPoint.dot(basis.tangent);
            const y = localPoint.dot(basis.bitangent);

            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    // Position and scale the highlight
    topFaceHighlight.position.copy(point);
    topFaceHighlight.scale.set(
        maxX - minX + 1,
        maxY - minY + 1,
        1
    );

    // Orient highlight to match face
    const rotMatrix = new THREE.Matrix4();
    rotMatrix.makeBasis(
        basis.tangent,
        basis.bitangent,
        basis.normal
    );
    topFaceHighlight.setRotationFromMatrix(rotMatrix);

    scene.add(topFaceHighlight);
    updateCircleList();
}

function exportCircleData() {
    if (!model) {
        updateStatus('No model loaded');
        return;
    }

    const faceGroups = groupHolesByFace(detectedCircles);
    
    const data = {
        faces: faceGroups.map((group, faceIndex) => {
            const faceNormal = group[0]?.normal || {x: 0, y: 0, z: 0};
            return {
                faceId: faceIndex + 1,
                normal: {
                    x: Math.round(faceNormal.x * 100) / 100,
                    y: Math.round(faceNormal.y * 100) / 100,
                    z: Math.round(faceNormal.z * 100) / 100
                },
                holes: group.map((circle, holeIndex) => ({
                    id: holeIndex + 1,
                    diameter: Math.round(circle.radius * 2 * 100) / 100,
                    position: {
                        x: Math.round(circle.center.x * 100) / 100,
                        y: Math.round(circle.center.y * 100) / 100,
                        z: Math.round(circle.center.z * 100) / 100
                    },
                    rotation: calculateRotation(circle.normal)
                })),
                alignedDistances: calculateAlignedDistances(group).map(d => ({
                    from: group.indexOf(d.from) + 1,
                    to: group.indexOf(d.to) + 1,
                    distance: Math.round(d.distance * 100) / 100,
                    axis: d.axis
                }))
            };
        }),
        orientationFace: {
            normal: {
                x: Math.round(topFaceNormal.x * 100) / 100,
                y: Math.round(topFaceNormal.y * 100) / 100,
                z: Math.round(topFaceNormal.z * 100) / 100
            },
            rotation: calculateRotation(topFaceNormal)
        },
        totalHoles: detectedCircles.length,
        timestamp: new Date().toISOString()
    };

    const fileName = document.getElementById('fileInput').files[0].name;
    const jsonFileName = fileName.replace(/\.stl$/i, '.json');

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = jsonFileName;
    link.click();
    URL.revokeObjectURL(url);
}

function resetView() {
    if (!model) return;
    
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    model.position.sub(center);
    
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(0, 0, maxDim * 2);
    camera.lookAt(0, 0, 0);
    
    controls.target.set(0, 0, 0);
    controls.update();
}

function updateStatus(message) {
    const status = document.getElementById('status');
    status.textContent = message;
}

function onWindowResize() {
    camera.aspect = window.innerWidth * 0.8 / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth * 0.8, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}